import type { PaymentGatewayPort } from '../ports/payment-gateway.port'
import type { PaymentRepository } from '../ports/payment.repository.port'
import { SILENT_PAYMENTS_LOGGER, type PaymentsLogger } from '../ports/payments-logger.port'
import { releaseAtProvider } from '../release-attempt'
import type { OnOrderExpiredCommand } from './on-order-expired.command'

/**
 * Consumidor de `order.cancelled` (Ruling B-75): el adaptador de `orders` ya canceló el intento
 * activo y `orders.payment_status` en la misma transacción que el pedido; acá se hace solo lo de
 * la pasarela. Cierra en Mercado Pago, con mejor esfuerzo, ese intento (`releaseAtProvider`: cancela
 * el pago pendiente y vence la preferencia) y después cierra los pagos del pedido como un
 * vencimiento ({@link OnOrderExpiredCommand}): cancela un intento que haya quedado activo (la
 * carrera aceptada con el inicio de un pago) y devuelve con `late_approval` lo que se cobró. Es
 * idempotente: la devolución lo es por `(intento, motivo)` y cerrar en la pasarela dos veces no
 * cambia nada.
 */
export class OnOrderCancelledCommand {
  /**
   * @param payments - Intentos (lectura por id).
   * @param gateway - Pasarela.
   * @param closePayments - Cierre de los pagos de un pedido que no se va a completar.
   * @param logger - Avisos de la cancelación de mejor esfuerzo.
   */
  constructor(
    private readonly payments: Pick<PaymentRepository, 'findById'>,
    private readonly gateway: PaymentGatewayPort,
    private readonly closePayments: Pick<OnOrderExpiredCommand, 'execute'>,
    private readonly logger: PaymentsLogger = SILENT_PAYMENTS_LOGGER,
  ) {}

  /**
   * @param orderId - Id del pedido cancelado (`payload.orderId`).
   * @param cancelledAttemptId - Intento que se canceló con el pedido (`payload.cancelledAttemptId`),
   *   o `null` si no había ninguno activo.
   * @throws {TypeError} En español, si `orderId` está vacío o `cancelledAttemptId` es un texto
   *   vacío.
   */
  async execute(orderId: string, cancelledAttemptId: string | null): Promise<void> {
    if (orderId.trim() === '') throw new TypeError('Falta el id del pedido cancelado')
    if (cancelledAttemptId !== null && cancelledAttemptId.trim() === '') {
      throw new TypeError('El id del intento cancelado no puede estar vacío')
    }
    if (cancelledAttemptId !== null) {
      const attempt = await this.payments.findById(cancelledAttemptId)
      if (attempt !== null && attempt.orderId === orderId) {
        await releaseAtProvider(this.gateway, attempt, this.logger)
      }
    }
    await this.closePayments.execute(orderId)
  }
}
