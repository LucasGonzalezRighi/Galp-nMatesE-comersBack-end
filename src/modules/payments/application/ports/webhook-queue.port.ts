/** Cola `payment-webhooks` (job `webhook.process`). */
export interface WebhookQueuePort {
  /**
   * Encola el procesado de una notificación registrada.
   *
   * @param eventId - Id de la fila de `webhook_events` (también el `jobId`).
   * @returns `false` si no se pudo encolar (Redis caído); nunca lanza.
   */
  enqueue(eventId: string): Promise<boolean>
}

/** Token de inyección del {@link WebhookQueuePort}. */
export const WEBHOOK_QUEUE_PORT = Symbol('WEBHOOK_QUEUE_PORT')
