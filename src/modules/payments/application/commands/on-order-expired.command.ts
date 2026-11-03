import type { PaymentGatewayPort } from '../ports/payment-gateway.port'
import type { PaymentRepository } from '../ports/payment.repository.port'
import { SILENT_PAYMENTS_LOGGER, type PaymentsLogger } from '../ports/payments-logger.port'
import { releaseAtProvider } from '../release-attempt'

/**
 * Consumidor de `order.expired` (Ruling B-43): cancela localmente el intento activo del pedido
 * vencido y, con mejor esfuerzo, vence la preferencia o cancela el pago en Mercado Pago.
 */
export class OnOrderExpiredCommand {
  /**
   * @param payments - Intentos.
   * @param gateway - Pasarela.
   * @param logger - Avisos de la cancelación de mejor esfuerzo.
   */
  constructor(
    private readonly payments: PaymentRepository,
    private readonly gateway: PaymentGatewayPort,
    private readonly logger: PaymentsLogger = SILENT_PAYMENTS_LOGGER,
  ) {}

  /**
   * @param orderId - Id del pedido vencido (`payload.orderId` del evento).
   */
  async execute(orderId: string): Promise<void> {
    const active = await this.payments.findActiveByOrder(orderId)
    if (active === null) return
    const cancelled = await this.payments.update(active.id, {
      status: 'cancelled',
      isActive: false,
      challengeUrl: null,
    })
    await releaseAtProvider(this.gateway, cancelled, this.logger)
  }
}
