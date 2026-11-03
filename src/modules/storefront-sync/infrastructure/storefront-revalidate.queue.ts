import type { JobsOptions } from 'bullmq'

/** Cola BullMQ de los avisos a la tienda (spec §6). */
export const STOREFRONT_REVALIDATE_QUEUE = 'storefront-revalidate'

/** Nombre del job que le pide a la tienda regenerar etiquetas. */
export const STOREFRONT_REVALIDATE_JOB = 'storefront.revalidate'

/**
 * Opciones de cada aviso: 8 intentos con backoff exponencial desde 1 s (unos 2 minutos en total,
 * lo que tarda en volver una tienda reiniciada). Los completados se borran a los 7 días; los
 * fallidos quedan (la cola de fallidos de la spec §6).
 */
export const STOREFRONT_REVALIDATE_JOB_OPTIONS = {
  attempts: 8,
  backoff: { type: 'exponential', delay: 1_000 },
  removeOnComplete: { age: 7 * 24 * 60 * 60 },
} as const satisfies JobsOptions

/** Datos de un job `storefront.revalidate` (su `jobId` es el id del evento del outbox). */
export interface StorefrontRevalidateJobData {
  /** Id del evento del outbox que lo originó. */
  eventId: string
  /** Tipo de ese evento, por ejemplo `combo.changed` (para los logs). */
  eventType: string
  /** Etiquetas a regenerar. */
  tags: string[]
}
