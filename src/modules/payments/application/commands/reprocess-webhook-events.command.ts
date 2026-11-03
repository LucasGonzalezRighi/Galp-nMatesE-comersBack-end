import type { Clock } from '../../../../shared/domain/clock'
import { SILENT_PAYMENTS_LOGGER, type PaymentsLogger } from '../ports/payments-logger.port'
import type { WebhookEventRepository } from '../ports/webhook-event.repository.port'
import { errorMessage } from '../release-attempt'
import type { ProcessWebhookEventCommand } from './process-webhook-event.command'

/** Notificaciones por pasada del barrido. */
export const REPROCESS_BATCH_SIZE = 50

/**
 * Cuánto se espera antes de retomar una notificación sin procesar: más que el backoff de los 5
 * intentos del job, así no pisa a un job que todavía está vivo.
 */
export const REPROCESS_AFTER_MS = 5 * 60_000

/** Hasta cuándo se retoma una notificación sin procesar (después se abandona, no se reintenta para siempre). */
export const REPROCESS_WINDOW_MS = 6 * 60 * 60_000

/** Resultado de una pasada. */
export interface ReprocessResult {
  /** Notificaciones procesadas sin error. */
  processed: number
  /** Notificaciones que fallaron (se avisan y siguen las demás; se vuelven a intentar en la próxima). */
  failed: number
}

/**
 * Retoma las notificaciones del webhook registradas y nunca procesadas (`processed_at IS NULL`):
 * la cola y el procesado en línea fallaron, o el job agotó sus 5 intentos después de que Mercado
 * Pago ya recibió su 200 y no va a reenviarlas. Corre en el barrido de 60 s y las procesa **en
 * línea** (no las encola: un job fallido con el mismo `jobId` sigue en Redis y `add` lo ignoraría).
 */
export class ReprocessWebhookEventsCommand {
  /**
   * @param events - Notificaciones.
   * @param process - Procesado de una notificación.
   * @param clock - Reloj.
   * @param logger - Avisos de las notificaciones que fallan.
   */
  constructor(
    private readonly events: WebhookEventRepository,
    private readonly process: Pick<ProcessWebhookEventCommand, 'execute'>,
    private readonly clock: Clock,
    private readonly logger: PaymentsLogger = SILENT_PAYMENTS_LOGGER,
  ) {}

  /**
   * @param limit - Máximo de notificaciones por pasada.
   * @returns Cuántas se procesaron y cuántas fallaron.
   * @throws {RangeError} En español, si el límite no es un entero positivo.
   */
  async execute(limit: number = REPROCESS_BATCH_SIZE): Promise<ReprocessResult> {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new RangeError(
        `El máximo de notificaciones a reprocesar tiene que ser un entero positivo (llegó ${String(limit)})`,
      )
    }
    const now = this.clock.now().getTime()
    const pending = await this.events.listUnprocessed(
      new Date(now - REPROCESS_AFTER_MS),
      new Date(now - REPROCESS_WINDOW_MS),
      limit,
    )
    const result: ReprocessResult = { processed: 0, failed: 0 }
    for (const event of pending) {
      try {
        await this.process.execute(event.id)
        result.processed += 1
      } catch (error: unknown) {
        result.failed += 1
        this.logger.warn(
          `No se pudo reprocesar la notificación ${event.eventId} de ${event.provider}: ${errorMessage(error)}`,
        )
      }
    }
    return result
  }
}
