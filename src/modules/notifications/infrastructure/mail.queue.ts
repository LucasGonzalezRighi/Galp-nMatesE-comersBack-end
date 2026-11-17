import type { JobsOptions } from 'bullmq'

import type { MailTemplate, OutgoingMail } from '../../../shared/application/ports/mail.port'

/** Cola BullMQ de los mails (LS-6). */
export const MAIL_QUEUE = 'mails'

/** Nombre del job que manda un mail. */
export const MAIL_JOB = 'mail.send'

/** Intentos de cada mail antes de quedar en fallidos. */
export const MAIL_ATTEMPTS = 5

/**
 * Opciones de un mail de un evento: 5 intentos con backoff exponencial desde 5 s (unos 75 s en
 * total). Los completados se borran a los 7 días (mientras están, un evento repetido no manda otro
 * mail); los fallidos quedan.
 */
export const MAIL_JOB_OPTIONS = {
  attempts: MAIL_ATTEMPTS,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: { age: 7 * 24 * 60 * 60 },
} as const satisfies JobsOptions

/**
 * Opciones del mail de restablecer contraseña: los mismos intentos, y el job se borra apenas sale
 * (lleva el enlace con el token, que no tiene que quedar guardado).
 */
export const DIRECT_MAIL_JOB_OPTIONS = {
  attempts: MAIL_ATTEMPTS,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: true,
} as const satisfies JobsOptions

/** Job de un mail que dispara un evento del outbox: guarda ids, los datos se leen al mandar. */
export interface EventMailJobData {
  /** Tipo de job. */
  kind: 'event'
  /** Id del evento del outbox. */
  eventId: string
  /** Tipo del evento (`order.created`…). */
  eventType: string
  /** Plantilla. */
  template: MailTemplate
  /** Payload del evento (ids; en `order.shipped`, también el seguimiento). */
  payload: unknown
}

/** Job de un mail ya armado (solo el de restablecer contraseña, que no pasa por el outbox). */
export interface DirectMailJobData {
  /** Tipo de job. */
  kind: 'direct'
  /** El mail. */
  mail: OutgoingMail
}

/** Datos de un job `mail.send`. */
export type MailJobData = EventMailJobData | DirectMailJobData

/**
 * `jobId` del mail de un evento: el id del evento y la plantilla. Si el outbox entrega el mismo
 * evento dos veces, BullMQ no acepta un segundo job con ese id y sale un solo mail.
 *
 * @param eventId - Id del evento.
 * @param template - Plantilla.
 * @returns `<eventId>-<plantilla>`.
 * @throws {TypeError} En español, si falta el id del evento.
 */
export function mailJobId(eventId: string, template: MailTemplate): string {
  if (eventId.trim() === '') throw new TypeError('El job de un mail necesita el id del evento')
  return `${eventId}-${template}`
}
