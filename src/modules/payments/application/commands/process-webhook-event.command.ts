import type { Clock } from '../../../../shared/domain/clock'
import type { PaymentGatewayPort } from '../ports/payment-gateway.port'
import type { WebhookEventRepository } from '../ports/webhook-event.repository.port'
import type { ApplyProviderPaymentCommand } from './apply-provider-payment.command'

/**
 * Procesa una notificación registrada (job `webhook.process` o en línea si la cola no anda):
 * `type !== 'payment'` se cierra sin más; si no, consulta el pago en Mercado Pago y lo aplica.
 * Un pago que Mercado Pago no tiene se cierra con `last_error` (Ruling B-38). Si la pasarela o la
 * aplicación fallan, el error sale para que la cola reintente.
 */
export class ProcessWebhookEventCommand {
  /**
   * @param events - Notificaciones.
   * @param gateway - Pasarela (consulta del pago).
   * @param apply - Máquina de estados.
   * @param clock - Reloj.
   */
  constructor(
    private readonly events: WebhookEventRepository,
    private readonly gateway: PaymentGatewayPort,
    private readonly apply: Pick<ApplyProviderPaymentCommand, 'execute'>,
    private readonly clock: Clock,
  ) {}

  /**
   * @param eventId - Id de la fila de `webhook_events`.
   */
  async execute(eventId: string): Promise<void> {
    const event = await this.events.findById(eventId)
    if (event?.processedAt !== null) return
    if (event.type !== 'payment' || event.resourceId === null) {
      await this.events.markProcessed(event.id, this.clock.now(), null)
      return
    }
    const payment = await this.gateway.getPayment(event.resourceId)
    if (payment === null) {
      await this.events.markProcessed(
        event.id,
        this.clock.now(),
        `Mercado Pago no tiene el pago ${event.resourceId}.`,
      )
      return
    }
    await this.apply.execute(payment, { attemptId: null, source: 'webhook' })
    await this.events.markProcessed(event.id, this.clock.now(), null)
  }
}
