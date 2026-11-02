import { newId } from './id'

/** Valor que se puede guardar como JSON (el `payload` de un evento va a `jsonb`). */
export type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject

/** Objeto JSON: claves de texto con valores JSON. */
export interface JsonObject {
  [key: string]: JsonValue
}

/**
 * Evento de dominio: algo que pasó en un agregado. Se guarda en `outbox_events` en la misma
 * transacción que el cambio y el relay del outbox lo publica en BullMQ.
 */
export interface DomainEvent {
  /** Id del evento (UUID v7); también es el `jobId` en la cola, así no se publica dos veces. */
  readonly id: string
  /** Tipo del evento, por ejemplo `order.created`. */
  readonly type: string
  /** Tipo del agregado que lo emitió, por ejemplo `order`. */
  readonly aggregateType: string
  /** Id del agregado que lo emitió. */
  readonly aggregateId: string
  /** Cuándo pasó. */
  readonly occurredAt: Date
  /** Datos del evento, serializables a JSON. */
  readonly payload: JsonObject
}

/** Lo que hace falta para crear un evento; el id y la fecha los completa {@link createDomainEvent}. */
export interface NewDomainEvent {
  /** Tipo del evento, por ejemplo `order.created`. */
  type: string
  /** Tipo del agregado, por ejemplo `order`. */
  aggregateType: string
  /** Id del agregado. */
  aggregateId: string
  /** Datos del evento. */
  payload: JsonObject
}

/**
 * Crea un evento de dominio con id nuevo.
 *
 * @param event - Tipo, agregado y datos del evento.
 * @param occurredAt - Cuándo pasó (en general, `clock.now()`).
 * @returns El evento listo para el outbox.
 * @throws {TypeError} En español, si `type`, `aggregateType` o `aggregateId` están vacíos, o si
 *   `occurredAt` no es una fecha válida.
 */
export function createDomainEvent(event: NewDomainEvent, occurredAt: Date): DomainEvent {
  for (const field of ['type', 'aggregateType', 'aggregateId'] as const) {
    if (event[field].trim() === '') {
      throw new TypeError(`Un evento de dominio necesita ${field}`)
    }
  }
  if (Number.isNaN(occurredAt.getTime())) {
    throw new TypeError('La fecha de un evento de dominio no es válida')
  }
  return { id: newId(), ...event, occurredAt }
}
