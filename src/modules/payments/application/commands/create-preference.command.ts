import type { Clock } from '../../../../shared/domain/clock'
import { newId } from '../../../../shared/domain/id'
import type { OrderForPayment } from '../../../orders/application/ports/order-payments.port'
import type { PaymentAttempt } from '../../domain/payment-attempt'
import type { OrderAccess, PaymentOrderAccess } from '../order-access'
import type { PaymentGatewayPort, PreferenceResult } from '../ports/payment-gateway.port'
import type { PaymentRepository } from '../ports/payment.repository.port'
import { SILENT_PAYMENTS_LOGGER, type PaymentsLogger } from '../ports/payments-logger.port'
import type { PaymentsSettings } from '../ports/payments-settings.port'
import type { PreferenceView } from '../read-models'
import { releaseAtProvider, releasedIdempotencyKey } from '../release-attempt'
import { attemptToResume } from '../resume-attempt'

/**
 * Dirección de la tienda a la que vuelve Mercado Pago (las tres `back_urls` y el simulador).
 *
 * @param storeOrigin - Origen de la tienda.
 * @param number - Número del pedido.
 * @returns `${storeOrigin}/checkout/resultado?pedido=<número>`.
 */
export function checkoutResultUrl(storeOrigin: string, number: string): string {
  return `${storeOrigin}/checkout/resultado?pedido=${encodeURIComponent(number)}`
}

/**
 * Valida una clave idempotente.
 *
 * @param idempotencyKey - Clave de la tienda.
 * @throws {TypeError} En español, si está vacía.
 */
export function assertIdempotencyKey(idempotencyKey: string): void {
  if (idempotencyKey.trim() === '') {
    throw new TypeError('El intento de pago necesita una Idempotency-Key')
  }
}

/**
 * `POST /orders/{number}/payments/mercadopago/preference`: cancela el intento activo anterior
 * (también en Mercado Pago, con mejor esfuerzo), crea un intento `mp_redirect` y la preferencia de
 * Checkout Pro, que vence con la reserva. Si la pasarela falla, el intento queda `cancelled` y
 * suelta su `idempotency_key` para que el reintento de la tienda (misma clave) cree otro.
 *
 * Si lo que falla es guardar una preferencia ya creada, el intento conserva su clave y el error
 * sale tal cual: el reintento con la misma `Idempotency-Key` retoma ese intento (sin cancelar el
 * activo ni crear otro) y vuelve a pedir la preferencia con la misma clave (Mercado Pago devuelve
 * la misma). Si el intento retomado ya tiene su `initPoint`, lo devuelve sin llamar a la pasarela.
 */
export class CreatePreferenceCommand {
  /**
   * @param access - Lectura del pedido con token.
   * @param payments - Intentos.
   * @param gateway - Pasarela.
   * @param settings - `notification_url`, origen de la tienda y descriptor.
   * @param clock - Reloj.
   * @param logger - Avisos de la cancelación de mejor esfuerzo.
   */
  constructor(
    private readonly access: PaymentOrderAccess,
    private readonly payments: PaymentRepository,
    private readonly gateway: PaymentGatewayPort,
    private readonly settings: PaymentsSettings,
    private readonly clock: Clock,
    private readonly logger: PaymentsLogger = SILENT_PAYMENTS_LOGGER,
  ) {}

  /**
   * @param access - Número y `X-Order-Token`.
   * @param idempotencyKey - `Idempotency-Key` de la tienda (va a Mercado Pago).
   * @returns El `initPoint` de la preferencia.
   * @throws {OrderNotFoundError} 404 sin token, con token ajeno o sin pedido.
   * @throws {OrderNotPayableError} 409 si el pedido no está `pending_payment`.
   * @throws {IdempotencyKeyReusedError} 422 si la clave es de un intento de otro pedido o de
   *   tarjeta.
   * @throws {PaymentGatewayError} 502 si Mercado Pago falla.
   */
  async execute(access: OrderAccess, idempotencyKey: string): Promise<PreferenceView> {
    assertIdempotencyKey(idempotencyKey)
    const order = await this.access.payable(access)
    const resumed = await attemptToResume(this.payments, idempotencyKey, order.id, 'mp_redirect')
    if (resumed !== null && resumed.initPoint !== null) return { initPoint: resumed.initPoint }
    const attempt = resumed ?? (await this.start(order, idempotencyKey))
    let preference: PreferenceResult
    try {
      preference = await this.gateway.createPreference({
        order,
        idempotencyKey,
        notificationUrl: this.settings.notificationUrl,
        backUrl: checkoutResultUrl(this.settings.storeOrigin, order.number),
        expiresAt: order.reservedUntil,
        statementDescriptor: this.settings.statementDescriptor,
      })
    } catch (error: unknown) {
      await this.payments.update(attempt.id, {
        status: 'cancelled',
        isActive: false,
        idempotencyKey: releasedIdempotencyKey(attempt),
      })
      throw error
    }
    // Fuera del `try`: si guardar falla, la preferencia ya existe en Mercado Pago, así que el
    // intento conserva la clave y el reintento la retoma.
    await this.payments.update(attempt.id, {
      providerPreferenceId: preference.preferenceId,
      initPoint: preference.initPoint,
    })
    return { initPoint: preference.initPoint }
  }

  /** Crea el intento `mp_redirect` activo y cierra en Mercado Pago el anterior (mejor esfuerzo). */
  private async start(order: OrderForPayment, idempotencyKey: string): Promise<PaymentAttempt> {
    const { attempt, previous } = await this.payments.startAttempt({
      id: newId(),
      orderId: order.id,
      method: 'mp_redirect',
      amountArs: order.totalArs,
      idempotencyKey,
      payerEmail: null,
      createdAt: this.clock.now(),
    })
    if (previous !== null) await releaseAtProvider(this.gateway, previous, this.logger)
    return attempt
  }
}
