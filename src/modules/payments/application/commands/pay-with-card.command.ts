import type { Clock } from '../../../../shared/domain/clock'
import { newId } from '../../../../shared/domain/id'
import type { PaymentAttempt } from '../../domain/payment-attempt'
import { PaymentGatewayError } from '../../domain/payments-errors'
import type { ProviderPayment } from '../../domain/provider-payment'
import type { OrderAccess, PaymentOrderAccess } from '../order-access'
import type { CardChargeInput, PaymentGatewayPort } from '../ports/payment-gateway.port'
import type { PaymentRepository } from '../ports/payment.repository.port'
import { SILENT_PAYMENTS_LOGGER, type PaymentsLogger } from '../ports/payments-logger.port'
import type { PaymentsSettings } from '../ports/payments-settings.port'
import type { CardPaymentResultView } from '../read-models'
import { releaseAtProvider, releasedIdempotencyKey } from '../release-attempt'
import { attemptToResume } from '../resume-attempt'
import type { ApplyProviderPaymentCommand } from './apply-provider-payment.command'
import { assertIdempotencyKey } from './create-preference.command'

/** `CardPaymentInput` del contrato (ya validado por el DTO). */
export interface CardPaymentInput {
  /** Token de la tarjeta (un solo uso). */
  token: string
  /** Marca (`visa`, `master`…). */
  paymentMethodId: string
  /** Banco emisor, o `null`. */
  issuerId: string | null
  /** Cuotas elegidas. */
  installments: number
  /** Pagador (email en minúsculas, documento normalizado). */
  payer: { email: string; identification: { type: string; number: string } }
}

/**
 * El resultado de la tarjeta que ve la tienda.
 *
 * @param attempt - Intento como quedó.
 * @returns `CardPaymentResult` con el desafío solo en `action_required`.
 */
export function toCardPaymentResult(attempt: PaymentAttempt): CardPaymentResultView {
  return {
    paymentStatus: attempt.status,
    statusDetail: attempt.statusDetail,
    challenge:
      attempt.status === 'action_required' && attempt.challengeUrl !== null
        ? { url: attempt.challengeUrl }
        : null,
  }
}

/**
 * `POST /orders/{number}/payments/mercadopago/card`: cancela el intento activo anterior, cobra con
 * el token y aplica la respuesta inmediata en la misma llamada (Ruling B-40): un `APRO` deja el
 * pedido pagado al instante. Un token o unas cuotas inválidos se rechazan antes de cancelar nada.
 * Si la pasarela falla al cobrar (502, error de red, un token que solo Mercado Pago sabe inválido),
 * el intento queda `cancelled`, suelta su `idempotency_key` para el reintento y el error sale tal
 * cual.
 *
 * Si lo que falla es aplicar un cobro que ya se hizo (la base, el pedido), el intento conserva su
 * clave y el error sale tal cual: el reintento de la tienda con la misma `Idempotency-Key` retoma
 * ese intento en vez de crear otro. Si ya tiene el id del pago, lo consulta en la pasarela y lo
 * aplica sin cobrar; si no, vuelve a cobrar con la misma clave (Mercado Pago devuelve el mismo
 * pago con el mismo `X-Idempotency-Key`) y lo aplica sobre el mismo intento.
 */
export class PayWithCardCommand {
  /**
   * @param access - Lectura del pedido con token.
   * @param payments - Intentos.
   * @param gateway - Pasarela.
   * @param apply - Máquina de estados.
   * @param settings - `notification_url` y descriptor.
   * @param clock - Reloj.
   * @param logger - Avisos de la cancelación de mejor esfuerzo.
   */
  constructor(
    private readonly access: PaymentOrderAccess,
    private readonly payments: PaymentRepository,
    private readonly gateway: PaymentGatewayPort,
    private readonly apply: Pick<ApplyProviderPaymentCommand, 'execute'>,
    private readonly settings: PaymentsSettings,
    private readonly clock: Clock,
    private readonly logger: PaymentsLogger = SILENT_PAYMENTS_LOGGER,
  ) {}

  /**
   * @param access - Número y `X-Order-Token`.
   * @param input - Token, cuotas y pagador.
   * @param idempotencyKey - `Idempotency-Key` de la tienda (va a Mercado Pago).
   * @returns El estado aplicado, con el desafío 3-D Secure si hace falta.
   * @throws {OrderNotFoundError} 404 sin token, con token ajeno o sin pedido.
   * @throws {OrderNotPayableError} 409 si el pedido no está `pending_payment`.
   * @throws {InvalidCardTokenError} 422 en `token`.
   * @throws {InstallmentsNotAvailableError} 422 en `installments` (simulador).
   * @throws {IdempotencyKeyReusedError} 422 si la clave es de un intento de otro pedido o de
   *   Checkout Pro.
   * @throws {PaymentGatewayError} 502 si Mercado Pago falla.
   */
  async execute(
    access: OrderAccess,
    input: CardPaymentInput,
    idempotencyKey: string,
  ): Promise<CardPaymentResultView> {
    assertIdempotencyKey(idempotencyKey)
    if (input.token.trim() === '') throw new TypeError('El pago con tarjeta necesita un token')
    const order = await this.access.payable(access)
    const charge: CardChargeInput = {
      order,
      idempotencyKey,
      token: input.token,
      paymentMethodId: input.paymentMethodId,
      issuerId: input.issuerId,
      installments: input.installments,
      payer: input.payer,
      notificationUrl: this.settings.notificationUrl,
      statementDescriptor: this.settings.statementDescriptor,
    }
    const resumed = await attemptToResume(this.payments, idempotencyKey, order.id, 'card')
    if (resumed !== null) return this.resume(resumed, charge)
    // Antes de tocar nada: un token o unas cuotas inválidas (422) no cancelan el intento activo.
    await this.gateway.validateCardCharge(charge)
    const { attempt, previous } = await this.payments.startAttempt({
      id: newId(),
      orderId: order.id,
      method: 'card',
      amountArs: order.totalArs,
      idempotencyKey,
      payerEmail: input.payer.email,
      createdAt: this.clock.now(),
    })
    if (previous !== null) await releaseAtProvider(this.gateway, previous, this.logger)
    return this.chargeAndApply(attempt, charge)
  }

  /**
   * Retoma el intento de una llegada anterior con la misma clave que no terminó: con el id del
   * pago lo consulta y lo aplica sin cobrar; sin él, cobra con la misma clave (la pasarela
   * devuelve el mismo pago) y lo aplica.
   *
   * @throws {PaymentGatewayError} 502 si la pasarela no encuentra el pago que el intento ya tiene
   *   (el intento queda como estaba, para el próximo reintento).
   */
  private async resume(
    attempt: PaymentAttempt,
    charge: CardChargeInput,
  ): Promise<CardPaymentResultView> {
    if (attempt.providerPaymentId === null) return this.chargeAndApply(attempt, charge)
    const payment = await this.gateway.getPayment(attempt.providerPaymentId)
    if (payment === null) {
      this.logger.warn(
        `Mercado Pago no encuentra el pago ${attempt.providerPaymentId} del intento ${attempt.id} que se reintentó`,
      )
      throw new PaymentGatewayError()
    }
    return this.applyTo(attempt, payment)
  }

  /**
   * Cobra y aplica. Si la pasarela falla, el intento queda `cancelled` con la clave suelta (no se
   * cobró: el reintento crea otro intento) y el error sale tal cual.
   */
  private async chargeAndApply(
    attempt: PaymentAttempt,
    charge: CardChargeInput,
  ): Promise<CardPaymentResultView> {
    let payment: ProviderPayment
    try {
      payment = await this.gateway.createCardPayment(charge)
    } catch (error: unknown) {
      await this.payments.update(attempt.id, {
        status: 'cancelled',
        isActive: false,
        idempotencyKey: releasedIdempotencyKey(attempt),
      })
      throw error
    }
    return this.applyTo(attempt, payment)
  }

  /**
   * Aplica el pago al intento, fuera del `try` de la pasarela a propósito: si falla (la base, el
   * pedido), el cobro ya se hizo, así que el intento conserva su clave y el error sale tal cual
   * para que el reintento con la misma clave lo retome.
   */
  private async applyTo(
    attempt: PaymentAttempt,
    payment: ProviderPayment,
  ): Promise<CardPaymentResultView> {
    const applied = await this.apply.execute(payment, { attemptId: attempt.id, source: 'card' })
    return toCardPaymentResult(applied ?? attempt)
  }
}
