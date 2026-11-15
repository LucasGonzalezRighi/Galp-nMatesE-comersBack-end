import type { OutboxJobData } from '../../src/shared/infrastructure/outbox/outbox.relay'
import {
  type DispatchFailureOutcome,
  OUTBOX_MAX_DISPATCH_ROUNDS,
  OUTBOX_REDISPATCH_MAX_MINUTES,
  type OutboxEventReader,
  type PendingOutboxEvent,
} from '../../src/shared/infrastructure/outbox/outbox.repository'

/**
 * Tabla `outbox_events` en memoria para `OutboxDispatcherProcessor`: los eventos que "guardó" el
 * módulo (el despachador los relee por id antes de actuar) y las reaperturas después de un despacho
 * que agotó sus reintentos, con las mismas reglas que `OutboxRepository`.
 */
export class InMemoryOutboxEvents implements OutboxEventReader {
  /** Eventos guardados, por id. */
  readonly events = new Map<string, PendingOutboxEvent>()
  /** Llamadas a {@link reopenAfterDispatchFailure}. */
  readonly reopened: { id: string; at: Date }[] = []

  /**
   * Guarda un evento como lo haría `append` y devuelve los datos del job que publicaría el relay.
   *
   * @param event - Tipo, id y payload del evento (lo demás tiene valores de prueba).
   * @returns Los datos del job.
   */
  save(event: { id: string; type: string; payload: unknown }): OutboxJobData {
    const occurredAt = new Date('2026-11-02T12:00:00.000Z')
    this.events.set(event.id, {
      id: event.id,
      type: event.type,
      aggregateType: 'order',
      aggregateId: 'agregado',
      occurredAt,
      payload: event.payload,
      dispatchFailures: 0,
    })
    return {
      id: event.id,
      type: event.type,
      aggregateType: 'order',
      aggregateId: 'agregado',
      occurredAt: occurredAt.toISOString(),
      payload: event.payload,
    }
  }

  /** {@inheritDoc OutboxEventReader.findById} */
  findById(id: string): Promise<PendingOutboxEvent | null> {
    const event = this.events.get(id)
    return Promise.resolve(event === undefined ? null : { ...event })
  }

  /** {@inheritDoc OutboxEventReader.reopenAfterDispatchFailure} */
  reopenAfterDispatchFailure(id: string, at: Date): Promise<DispatchFailureOutcome> {
    this.reopened.push({ id, at })
    const event = this.events.get(id)
    if (event === undefined) return Promise.resolve({ status: 'missing' })
    if (event.dispatchFailures >= OUTBOX_MAX_DISPATCH_ROUNDS) {
      return Promise.resolve({ status: 'exhausted', dispatchFailures: event.dispatchFailures })
    }
    const minutes = Math.min(OUTBOX_REDISPATCH_MAX_MINUTES, 2 ** event.dispatchFailures)
    event.dispatchFailures += 1
    return Promise.resolve({
      status: 'reopened',
      dispatchFailures: event.dispatchFailures,
      availableAt: new Date(at.getTime() + minutes * 60_000),
    })
  }
}
