import { InjectQueue } from '@nestjs/bullmq'
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common'
import type { JobsOptions, Queue } from 'bullmq'

import { ENV, type Env } from '../../../config/env'
import { CLOCK, type Clock } from '../../domain/clock'
import { createRateLimitedWarn, errorMessage } from '../redis/rate-limited-warn'
import { OUTBOX_BATCH_SIZE, OutboxRepository, type PendingOutboxEvent } from './outbox.repository'

/** Nombre de la cola BullMQ donde el relay publica los eventos. */
export const OUTBOX_QUEUE = 'outbox'

/** Cada cuánto corre el relay. */
export const OUTBOX_RELAY_INTERVAL_MS = 2_000

/** Opciones de cada job: 5 intentos con backoff exponencial; los completados se borran a los 7 días. */
export const OUTBOX_JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 1_000 },
  removeOnComplete: { age: 7 * 24 * 60 * 60 },
} as const satisfies JobsOptions

/** Datos de un job de la cola `outbox` (el nombre del job es el `type` del evento). */
export interface OutboxJobData {
  /** Id del evento. */
  id: string
  /** Tipo del evento. */
  type: string
  /** Tipo del agregado. */
  aggregateType: string
  /** Id del agregado. */
  aggregateId: string
  /** Cuándo pasó, en ISO 8601. */
  occurredAt: string
  /** Datos del evento. */
  payload: unknown
}

/**
 * Arma los datos del job de un evento (los mismos campos que guarda `outbox_events`).
 *
 * @param event - El evento guardado.
 * @returns Los datos del job.
 */
export function toJobData(event: Omit<PendingOutboxEvent, 'dispatchFailures'>): OutboxJobData {
  return {
    id: event.id,
    type: event.type,
    aggregateType: event.aggregateType,
    aggregateId: event.aggregateId,
    occurredAt: event.occurredAt.toISOString(),
    payload: event.payload,
  }
}

/**
 * `jobId` de un evento en su vuelta de despacho: el id del evento la primera vez y
 * `<id>-r<vuelta>` cuando se reabrió (BullMQ guarda el job fallido con el id anterior y no
 * aceptaría otro igual).
 *
 * @param event - Id y despachos fallidos del evento.
 * @returns El `jobId`.
 */
export function outboxJobId(event: Pick<PendingOutboxEvent, 'id' | 'dispatchFailures'>): string {
  return event.dispatchFailures === 0 ? event.id : `${event.id}-r${String(event.dispatchFailures)}`
}

/**
 * Relay del outbox: cada {@link OUTBOX_RELAY_INTERVAL_MS} toma hasta 50 eventos sin publicar (y ya
 * disponibles), los encola en `outbox` con el `jobId` de {@link outboxJobId} (si se publica dos
 * veces en la misma vuelta, BullMQ no duplica el job) y marca `published_at`. Si Redis falla, suma
 * un intento y reintenta en la próxima vuelta. Un evento cuyo despacho agotó los reintentos vuelve
 * acá con otra vuelta (lo reabre `OutboxDispatcherProcessor`, auditoría NV-29).
 *
 * Con `NODE_ENV=test` el temporizador no arranca: los E2E llaman a {@link runOnce} a mano.
 */
@Injectable()
export class OutboxRelay implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(OutboxRelay.name)
  private readonly warn = createRateLimitedWarn(this.logger)
  private timer: NodeJS.Timeout | undefined
  private running: Promise<number> | undefined

  /**
   * @param queue - Cola `outbox` de BullMQ.
   * @param outbox - Tabla `outbox_events`.
   * @param clock - Reloj de la app (para `published_at`).
   * @param env - Variables de entorno validadas (para no arrancar en test).
   */
  constructor(
    @InjectQueue(OUTBOX_QUEUE) private readonly queue: Queue,
    private readonly outbox: OutboxRepository,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ENV) private readonly env: Env,
  ) {
    this.queue.on('error', (error: Error) => {
      this.warn(`La cola del outbox no llega a Redis: ${error.message}`)
    })
  }

  /** Arranca el temporizador, salvo con `NODE_ENV=test`. */
  onApplicationBootstrap(): void {
    if (this.env.NODE_ENV === 'test') return
    this.timer = setInterval(() => {
      void this.runOnce()
    }, OUTBOX_RELAY_INTERVAL_MS)
  }

  /** Detiene el temporizador y espera la vuelta en curso, si la hay. */
  async onModuleDestroy(): Promise<void> {
    clearInterval(this.timer)
    this.timer = undefined
    await this.running
  }

  /**
   * Publica una tanda de eventos pendientes. Si ya hay una vuelta en curso, devuelve esa (no
   * corren dos a la vez en la misma instancia). Nunca lanza: los fallos se loguean.
   *
   * @returns Cuántos eventos publicó.
   */
  runOnce(): Promise<number> {
    this.running ??= this.publishPending().finally(() => {
      this.running = undefined
    })
    return this.running
  }

  private async publishPending(): Promise<number> {
    let events: PendingOutboxEvent[]
    try {
      events = await this.outbox.findUnpublished(this.clock.now(), OUTBOX_BATCH_SIZE)
    } catch (error) {
      this.warn(`No se pudieron leer los eventos del outbox: ${errorMessage(error)}`)
      return 0
    }
    let published = 0
    for (const event of events) {
      try {
        await this.queue.add(event.type, toJobData(event), {
          ...OUTBOX_JOB_OPTIONS,
          jobId: outboxJobId(event),
        })
        await this.outbox.markPublished(event.id, this.clock.now())
        published += 1
      } catch (error) {
        this.warn(`No se pudo publicar el evento ${event.id} del outbox: ${errorMessage(error)}`)
        await this.outbox.recordFailure(event.id).catch((failure: unknown) => {
          this.warn(`No se pudo registrar el intento fallido del outbox: ${errorMessage(failure)}`)
        })
        break
      }
    }
    return published
  }
}
