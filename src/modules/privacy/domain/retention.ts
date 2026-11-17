/**
 * Plazos de conservación de datos personales (LS-5, `docs/adr/0008-datos-personales.md`). Es el
 * único lugar donde viven: la purga diaria y la política de privacidad dicen lo mismo.
 */
export interface RetentionPolicy {
  /** Claves de idempotencia: horas desde que se crean. */
  readonly idempotencyKeysHours: number
  /** Tokens de restablecer contraseña: días después de vencer. */
  readonly expiredPasswordResetTokensDays: number
  /** Mensajes del formulario de contacto: meses desde que llegan. */
  readonly contactMessagesMonths: number
  /** Eventos de webhook procesados: días desde que se procesaron. */
  readonly processedWebhookEventsDays: number
  /** Eventos del outbox publicados: días desde que se publicaron. */
  readonly publishedOutboxEventsDays: number
  /** Reseñas pendientes o rechazadas (ocultas): meses desde que se escribieron. */
  readonly unapprovedReviewsMonths: number
  /** Pedidos (con pagos y devoluciones): años. Obligación de conservar registros; no se purgan acá. */
  readonly ordersYears: number
  /** Solicitudes de arrepentimiento: años. Igual que los pedidos; no se purgan acá. */
  readonly withdrawalRequestsYears: number
}

/** Los plazos vigentes. */
export const RETENTION: RetentionPolicy = {
  idempotencyKeysHours: 48,
  expiredPasswordResetTokensDays: 7,
  contactMessagesMonths: 24,
  processedWebhookEventsDays: 90,
  publishedOutboxEventsDays: 90,
  unapprovedReviewsMonths: 12,
  ordersYears: 10,
  withdrawalRequestsYears: 10,
}

/**
 * Lo que la purga borra. Nunca pedidos, pagos, devoluciones, solicitudes de arrepentimiento ni
 * reseñas aprobadas.
 */
export const PURGE_TARGETS = [
  'idempotencyKeys',
  'passwordResetTokens',
  'contactMessages',
  'webhookEvents',
  'outboxEvents',
  'reviews',
] as const

/** Un tipo de dato que la purga borra. */
export type PurgeTarget = (typeof PURGE_TARGETS)[number]

/** Fecha de corte por tipo de dato: se borra lo que tenga su fecha de referencia antes del corte. */
export type PurgeCutoffs = Record<PurgeTarget, Date>

const HOUR_MS = 60 * 60 * 1_000
const DAY_MS = 24 * HOUR_MS

/** `now` menos `months` meses de calendario (en UTC). */
function monthsBefore(now: Date, months: number): Date {
  const date = new Date(now.getTime())
  date.setUTCMonth(date.getUTCMonth() - months)
  return date
}

/**
 * Calcula el corte de cada tipo de dato con {@link RETENTION}.
 *
 * @param now - El momento de la purga.
 * @returns El corte por tipo de dato.
 * @throws Error si `now` no es una fecha válida.
 */
export function purgeCutoffs(now: Date): PurgeCutoffs {
  if (Number.isNaN(now.getTime())) throw new Error('La fecha de la purga no es válida')
  const at = now.getTime()
  return {
    idempotencyKeys: new Date(at - RETENTION.idempotencyKeysHours * HOUR_MS),
    passwordResetTokens: new Date(at - RETENTION.expiredPasswordResetTokensDays * DAY_MS),
    contactMessages: monthsBefore(now, RETENTION.contactMessagesMonths),
    webhookEvents: new Date(at - RETENTION.processedWebhookEventsDays * DAY_MS),
    outboxEvents: new Date(at - RETENTION.publishedOutboxEventsDays * DAY_MS),
    reviews: monthsBefore(now, RETENTION.unapprovedReviewsMonths),
  }
}
