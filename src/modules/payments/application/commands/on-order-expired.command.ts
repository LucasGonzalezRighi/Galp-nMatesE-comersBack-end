import type { PaymentAttempt } from '../../domain/payment-attempt'
import type { PaymentGatewayPort } from '../ports/payment-gateway.port'
import type { PaymentRepository } from '../ports/payment.repository.port'
import { SILENT_PAYMENTS_LOGGER, type PaymentsLogger } from '../ports/payments-logger.port'
import { releaseAtProvider } from '../release-attempt'
import type { ApplyProviderPaymentCommand } from './apply-provider-payment.command'

/**
 * Indica si un intento cobró algo que todavía no se devolvió: `approved`, o `partially_refunded`
 * con saldo (los dos con el pago en la pasarela).
 */
function holdsCollectedBalance(attempt: PaymentAttempt): boolean {
  if (attempt.providerPaymentId === null) return false
  if (attempt.status === 'approved') return true
  return attempt.status === 'partially_refunded' && attempt.refundedArs < attempt.amountArs
}

/**
 * Consumidor de `order.expired` (Ruling B-43): cancela localmente el intento activo del pedido
 * vencido y, con mejor esfuerzo, vence la preferencia o cancela el pago en Mercado Pago. Además
 * devuelve (motivo `late_approval`) todo lo que el pedido cobró y no se completó: un aprobado
 * parcial de un Checkout Pro dividido cuyo segundo pago salió `rejected`/`cancelled` (o que el
 * cliente reemplazó por otro intento) deja el pedido vencible, y sin esto vencería con la plata
 * cobrada. La devolución es idempotente por `(intento, motivo)`, así que un evento repetido no
 * devuelve dos veces; si la pasarela falla, la fila queda `failed` y se avisa ("Devolvelo desde
 * Mercado Pago").
 */
export class OnOrderExpiredCommand {
  /**
   * @param payments - Intentos.
   * @param gateway - Pasarela.
   * @param refunds - Devolución de un aprobado (`ApplyProviderPaymentCommand.refundApproved`).
   * @param logger - Avisos de la cancelación de mejor esfuerzo.
   */
  constructor(
    private readonly payments: PaymentRepository,
    private readonly gateway: PaymentGatewayPort,
    private readonly refunds: Pick<ApplyProviderPaymentCommand, 'refundApproved'>,
    private readonly logger: PaymentsLogger = SILENT_PAYMENTS_LOGGER,
  ) {}

  /**
   * @param orderId - Id del pedido vencido (`payload.orderId` del evento).
   */
  async execute(orderId: string): Promise<void> {
    const active = await this.payments.findActiveByOrder(orderId)
    if (active !== null) {
      const cancelled = await this.payments.update(active.id, {
        status: 'cancelled',
        isActive: false,
        challengeUrl: null,
      })
      await releaseAtProvider(this.gateway, cancelled, this.logger)
    }
    for (const attempt of await this.payments.listByOrder(orderId)) {
      if (holdsCollectedBalance(attempt)) {
        await this.refunds.refundApproved(attempt, 'late_approval')
      }
    }
  }
}
