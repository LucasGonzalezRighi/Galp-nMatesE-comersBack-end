import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq'
import { Inject, Logger, type OnModuleDestroy } from '@nestjs/common'
import type { Job, Queue } from 'bullmq'
import { isDeepStrictEqual } from 'node:util'

import { CLOCK, type Clock } from '../../domain/clock'
import { closeWorker } from '../redis/close-worker'
import { createRateLimitedWarn, errorMessage } from '../redis/rate-limited-warn'
import { OutboxHandlerRegistry } from './outbox-handler.registry'
import { OUTBOX_QUEUE, type OutboxJobData, toJobData } from './outbox.relay'
import { type OutboxEventReader, OutboxRepository } from './outbox.repository'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Id del evento que dice traer un job (`data.id`), o `null` si no trae uno. */
function claimedEventId(job: Job<OutboxJobData>): string | null {
  const data: unknown = job.data
  return isRecord(data) && typeof data.id === 'string' ? data.id : null
}

/**
 * Único consumidor de la cola `outbox` (BullMQ le da cada job a un solo worker, así que dos
 * processors de la misma cola se repartirían los eventos). Despacha por `job.name` (el `type` del
 * evento) a los handlers de {@link OutboxHandlerRegistry}, uno detrás del otro: un tipo sin
 * handlers termina sin hacer nada y, si un handler lanza, el job falla y BullMQ lo reintenta con
 * `OUTBOX_JOB_OPTIONS` (corren otra vez todos los handlers del tipo).
 *
 * Antes de actuar relee el evento de `outbox_events` por su id (auditoría NV-27): si no existe, es
 * de otro tipo o su payload no coincide con el del job, el job no lo publicó el relay (alguien
 * escribió en Redis) y se descarta con un error en el log; los handlers reciben siempre el evento
 * guardado. Cuando un job agota sus reintentos, el evento vuelve a quedar pendiente para el relay
 * con un contador y una espera creciente, hasta un tope (auditoría NV-29).
 */
@Processor(OUTBOX_QUEUE)
export class OutboxDispatcherProcessor extends WorkerHost implements OnModuleDestroy {
  private readonly logger = new Logger(OutboxDispatcherProcessor.name)
  /** Avisos de conexión y de jobs fallidos, cada uno con su propio límite de uno por minuto. */
  private readonly warnConnection = createRateLimitedWarn(this.logger)
  private readonly warnFailed = createRateLimitedWarn(this.logger)

  /**
   * @param registry - Handlers de cada tipo de evento.
   * @param queue - Cola `outbox` (para comprobar que Redis contesta al cerrar).
   * @param outbox - Tabla `outbox_events` (releer el evento y reabrirlo).
   * @param clock - Reloj (cuándo falló un despacho).
   */
  constructor(
    private readonly registry: OutboxHandlerRegistry,
    @InjectQueue(OUTBOX_QUEUE) private readonly queue: Queue<OutboxJobData>,
    @Inject(OutboxRepository) private readonly outbox: OutboxEventReader,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {
    super()
    this.queue.on('error', (error: Error) => {
      this.warnConnection(`La cola del outbox no llega a Redis: ${error.message}`)
    })
  }

  /**
   * Despacha un evento del outbox a sus handlers, en orden, con el evento como está guardado.
   *
   * @param job - Job con el evento (`job.name` = tipo).
   * @throws Lo que lance un handler o la lectura del evento (el job falla y se reintenta).
   */
  async process(job: Job<OutboxJobData>): Promise<void> {
    const handlers = this.registry.handlersFor(job.name)
    if (handlers.length === 0) return
    const eventId = claimedEventId(job)
    const stored = eventId === null ? null : await this.outbox.findById(eventId)
    const data: unknown = job.data
    const matches =
      stored?.type === job.name && isRecord(data) && isDeepStrictEqual(data.payload, stored.payload)
    if (stored === null || !matches) {
      this.logger.error(
        `El job ${String(job.id)} (${job.name}) no coincide con el evento ${String(eventId)} del outbox: se descarta sin despachar`,
      )
      return
    }
    const event = toJobData(stored)
    for (const handler of handlers) {
      await handler.handle(event)
    }
  }

  /** Cierra el worker (forzado si Redis no contesta); ver {@link closeWorker}. */
  async onModuleDestroy(): Promise<void> {
    await closeWorker(this, this.queue)
  }

  /**
   * Avisa (como mucho una vez por minuto) cuando el worker no llega a Redis.
   *
   * @param error - Error de la conexión.
   */
  @OnWorkerEvent('error')
  onError(error: Error): void {
    this.warnConnection(`El worker del outbox no llega a Redis: ${errorMessage(error)}`)
  }

  /**
   * Un despacho falló. Si BullMQ lo va a reintentar, avisa (como mucho una vez por minuto); si fue
   * el último intento (o el job quedó trabado y BullMQ lo dio por fallido), vuelve a dejar el evento
   * pendiente para el relay con espera creciente y, pasado el tope, deja un error en el log: el
   * evento se perdió. Nunca lanza.
   *
   * @param job - Job que falló, si se conoce.
   * @param error - Motivo.
   */
  @OnWorkerEvent('failed')
  async onFailed(job: Job<OutboxJobData> | undefined, error: Error): Promise<void> {
    const name = job?.name ?? 'desconocido'
    const jobId = job?.id ?? 'desconocido'
    const reason = errorMessage(error)
    if (job === undefined || !(await this.isTerminal(job))) {
      this.warnFailed(`No se pudo despachar el evento ${name} (job ${jobId}): ${reason}`)
      return
    }
    const eventId = claimedEventId(job) ?? jobId
    try {
      const outcome = await this.outbox.reopenAfterDispatchFailure(eventId, this.clock.now())
      if (outcome.status === 'reopened') {
        this.logger.error(
          `El evento ${eventId} (${name}) agotó los reintentos (${reason}): vuelve a quedar pendiente desde ${outcome.availableAt.toISOString()} (vuelta ${String(outcome.dispatchFailures)})`,
        )
      } else if (outcome.status === 'exhausted') {
        this.logger.error(
          `El evento ${eventId} (${name}) se perdió: agotó los reintentos en ${String(outcome.dispatchFailures + 1)} vueltas (${reason}). Hay que revisarlo a mano: con published_at en null el relay lo vuelve a publicar.`,
        )
      } else {
        this.logger.error(
          `El job ${jobId} (${name}) agotó los reintentos y su evento no está en el outbox`,
        )
      }
    } catch (failure: unknown) {
      this.logger.error(
        `El evento ${eventId} (${name}) agotó los reintentos y no se pudo reabrir: ${errorMessage(failure)}`,
      )
    }
  }

  /** Si BullMQ ya no lo reintenta: gastó todos los intentos o quedó en la lista de fallidos. */
  private async isTerminal(job: Job<OutboxJobData>): Promise<boolean> {
    if (job.attemptsMade >= (job.opts.attempts ?? 1)) return true
    return job.isFailed().catch(() => false)
  }
}
