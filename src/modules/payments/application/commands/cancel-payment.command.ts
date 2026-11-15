import type { OrderAccess, PaymentOrderAccess } from '../order-access'
import type { PaymentGatewayPort } from '../ports/payment-gateway.port'
import type { PaymentRepository } from '../ports/payment.repository.port'
import { SILENT_PAYMENTS_LOGGER, type PaymentsLogger } from '../ports/payments-logger.port'
import { releaseAtProvider } from '../release-attempt'

/**
 * `POST /orders/{number}/cancel-payment`: el intento activo queda `cancelled` (y
 * `orders.payment_status = cancelled`, así el pedido vuelve a ser vencible); el pedido conserva la
 * reserva y `reservedUntil`. Sin intento activo no hace nada (204 igual). Cancela en Mercado Pago
 * con mejor esfuerzo (Ruling B-44). La cancelación es condicional (auditoría NV-06): si el intento
 * se aprobó (o se cerró) entre la lectura y la escritura, no se toca ni se cancela en la pasarela.
 */
export class CancelPaymentCommand {
  /**
   * @param access - Lectura del pedido con token.
   * @param payments - Intentos.
   * @param gateway - Pasarela.
   * @param logger - Avisos de la cancelación de mejor esfuerzo.
   */
  constructor(
    private readonly access: PaymentOrderAccess,
    private readonly payments: PaymentRepository,
    private readonly gateway: PaymentGatewayPort,
    private readonly logger: PaymentsLogger = SILENT_PAYMENTS_LOGGER,
  ) {}

  /**
   * @param access - Número y `X-Order-Token`.
   * @throws {OrderNotFoundError} 404 sin token, con token ajeno o sin pedido.
   * @throws {OrderNotPayableError} 409 si el pedido no está `pending_payment`.
   */
  async execute(access: OrderAccess): Promise<void> {
    const order = await this.access.payable(access)
    const active = await this.payments.findActiveByOrder(order.id)
    if (active === null) return
    const cancelled = await this.payments.cancelActive(active.id)
    if (cancelled !== null) await releaseAtProvider(this.gateway, cancelled, this.logger)
  }
}
