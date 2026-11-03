import type { JobsOptions } from 'bullmq'

/** Cola BullMQ de los vencimientos de pedidos (jobs diferidos hasta `reserved_until`). */
export const ORDER_EXPIRATION_QUEUE = 'order-expiration'

/** Nombre del job que vence un pedido. */
export const ORDER_EXPIRE_JOB = 'order.expire'

/** Datos del job {@link ORDER_EXPIRE_JOB}. */
export interface OrderExpireJobData {
  /** Id del pedido (también es el `jobId`). */
  orderId: string
}

/**
 * Opciones fijas de cada job de vencimiento: 5 intentos con backoff exponencial; los completados
 * se borran a los 7 días (el `delay` y el `jobId` los pone el scheduler).
 */
export const ORDER_EXPIRE_JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 1_000 },
  removeOnComplete: { age: 7 * 24 * 60 * 60 },
} as const satisfies JobsOptions
