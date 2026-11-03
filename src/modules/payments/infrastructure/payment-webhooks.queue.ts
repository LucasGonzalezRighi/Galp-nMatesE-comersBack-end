import type { JobsOptions } from 'bullmq'

/** Cola BullMQ de las notificaciones de Mercado Pago (spec §6, Ruling B-56). */
export const PAYMENT_WEBHOOKS_QUEUE = 'payment-webhooks'

/** Nombre del job que procesa una notificación registrada. */
export const WEBHOOK_PROCESS_JOB = 'webhook.process'

/** Datos del job {@link WEBHOOK_PROCESS_JOB}. */
export interface WebhookJobData {
  /** Id de la fila de `webhook_events` (también es el `jobId`: encolarla dos veces no duplica). */
  eventId: string
}

/**
 * Opciones fijas de cada job de notificación (Ruling B-38): 5 intentos con backoff exponencial;
 * los completados se borran a los 7 días (el `jobId` lo pone `BullWebhookQueue`).
 */
export const WEBHOOK_JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 1_000 },
  removeOnComplete: { age: 7 * 24 * 60 * 60 },
} as const satisfies JobsOptions
