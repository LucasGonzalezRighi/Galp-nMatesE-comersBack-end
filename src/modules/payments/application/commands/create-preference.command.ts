import type { Clock } from '../../../../shared/domain/clock'
import { newId } from '../../../../shared/domain/id'
import type { OrderAccess, PaymentOrderAccess } from '../order-access'
import type { PaymentGatewayPort } from '../ports/payment-gateway.port'
import type { PaymentRepository } from '../ports/payment.repository.port'
import { SILENT_PAYMENTS_LOGGER, type PaymentsLogger } from '../ports/payments-logger.port'
import type { PaymentsSettings } from '../ports/payments-settings.port'
import type { PreferenceView } from '../read-models'
import { releaseAtProvider } from '../release-attempt'

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
 * Checkout Pro, que vence con la reserva. Si la pasarela falla, el intento queda `cancelled`.
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
   * @throws {PaymentGatewayError} 502 si Mercado Pago falla.
   */
  async execute(access: OrderAccess, idempotencyKey: string): Promise<PreferenceView> {
    assertIdempotencyKey(idempotencyKey)
    const order = await this.access.payable(access)
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
    try {
      const preference = await this.gateway.createPreference({
        order,
        idempotencyKey,
        notificationUrl: this.settings.notificationUrl,
        backUrl: checkoutResultUrl(this.settings.storeOrigin, order.number),
        expiresAt: order.reservedUntil,
        statementDescriptor: this.settings.statementDescriptor,
      })
      await this.payments.update(attempt.id, {
        providerPreferenceId: preference.preferenceId,
        initPoint: preference.initPoint,
      })
      return { initPoint: preference.initPoint }
    } catch (error: unknown) {
      await this.payments.update(attempt.id, { status: 'cancelled', isActive: false })
      throw error
    }
  }
}
