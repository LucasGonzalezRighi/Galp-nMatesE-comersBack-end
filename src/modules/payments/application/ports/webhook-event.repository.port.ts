import type { JsonObject } from '../../../../shared/domain/domain-event'
import type { PaymentProvider } from '../../domain/payment-attempt'

/** Notificación recibida (fila nueva de `webhook_events`). */
export interface NewWebhookEvent {
  /** Pasarela. */
  provider: PaymentProvider
  /** Clave de deduplicación: `id` del cuerpo o, si no viene, `x-request-id` (Ruling B-37). */
  eventId: string
  /** `type` del cuerpo (`payment`…). */
  type: string
  /** `action` del cuerpo, o `null`. */
  action: string | null
  /** `data.id` (el pago), o `null`. */
  resourceId: string | null
  /** Si la firma era válida (siempre `true`: con firma inválida no se registra). */
  signatureValid: boolean
  /** Cuerpo tal cual. */
  payload: JsonObject
  /** Recepción. */
  receivedAt: Date
}

/** Notificación guardada. */
export type StoredWebhookEvent = NewWebhookEvent & {
  /** Id de la fila. */
  id: string
  /** Cuándo se procesó, o `null`. */
  processedAt: Date | null
  /** Intentos de procesado. */
  attempts: number
}

/** Notificaciones de la pasarela (tabla `webhook_events`). */
export interface WebhookEventRepository {
  /**
   * Registra una notificación una sola vez por `(provider, eventId)`.
   *
   * @param input - Notificación.
   * @returns Id de la fila y si ya existía (`duplicate`: no se reprocesa).
   */
  record(input: NewWebhookEvent): Promise<{ id: string; duplicate: boolean }>
  /**
   * @param id - Id de la fila.
   * @returns La notificación, o `null`.
   */
  findById(id: string): Promise<StoredWebhookEvent | null>
  /**
   * Marca la notificación como procesada.
   *
   * @param id - Id de la fila.
   * @param at - Momento del procesado.
   * @param lastError - Motivo si se cerró sin aplicar nada (pago inexistente), o `null`.
   */
  markProcessed(id: string, at: Date, lastError: string | null): Promise<void>
}

/** Token de inyección del {@link WebhookEventRepository}. */
export const WEBHOOK_EVENT_REPOSITORY = Symbol('WEBHOOK_EVENT_REPOSITORY')
