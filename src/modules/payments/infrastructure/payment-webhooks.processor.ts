import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq'
import { Inject, Logger, type OnModuleDestroy } from '@nestjs/common'
import type { Job, Queue, Worker } from 'bullmq'

import {
  createRateLimitedWarn,
  errorMessage,
} from '../../../shared/infrastructure/redis/rate-limited-warn'
import { WORKER_SHUTDOWN_PROBE_MS } from '../../orders/infrastructure/order-expiration.processor'
import { ProcessWebhookEventCommand } from '../application/commands/process-webhook-event.command'
import {
  PAYMENT_WEBHOOKS_QUEUE,
  WEBHOOK_PROCESS_JOB,
  type WebhookJobData,
} from './payment-webhooks.queue'
import { PrismaWebhookEventRepository } from './prisma-webhook-event.repository'

/**
 * Indica si Redis contesta a tiempo (las colas no encolan offline: con Redis caído fallan al
 * toque). Lo usan los workers de pagos al cerrar.
 *
 * @param queue - Cola a sondear.
 * @returns `true` si `getJobCounts` contesta en {@link WORKER_SHUTDOWN_PROBE_MS}.
 */
export async function redisAnswers(queue: Pick<Queue, 'getJobCounts'>): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => {
      resolve(false)
    }, WORKER_SHUTDOWN_PROBE_MS)
  })
  const probe = queue.getJobCounts('waiting').then(
    () => true,
    () => false,
  )
  try {
    return await Promise.race([probe, timeout])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Cierra el worker de un processor antes que el resto de la app, como `OrderExpirationProcessor`:
 * con Redis caído el cierre normal de BullMQ espera para siempre (y `app.close()` queda colgado),
 * así que si Redis no contesta lo cierra forzado (el job en curso queda estancado y se reintenta).
 * Sin `app.init()` no hay worker y no hace nada.
 *
 * @param host - Processor (su `worker` lanza si todavía no existe).
 * @param queue - Cola del processor, para sondear Redis.
 */
export async function closeWorker(
  host: WorkerHost,
  queue: Pick<Queue, 'getJobCounts'>,
): Promise<void> {
  let worker: Worker
  try {
    worker = host.worker
  } catch {
    return
  }
  await worker.close(!(await redisAnswers(queue)))
}

/**
 * Worker de la cola `payment-webhooks` (Ruling B-38): cada job `webhook.process` procesa su
 * notificación con {@link ProcessWebhookEventCommand} (idempotente: una ya procesada no hace
 * nada). Si falla, anota el intento y el error en la fila y relanza: BullMQ reintenta (5 intentos,
 * backoff exponencial) y, si se agotan, el barrido de 60 s la retoma en línea.
 */
@Processor(PAYMENT_WEBHOOKS_QUEUE)
export class PaymentWebhooksProcessor extends WorkerHost implements OnModuleDestroy {
  private readonly logger = new Logger(PaymentWebhooksProcessor.name)
  /** Avisos de conexión y de jobs fallidos, cada uno con su propio límite de uno por minuto. */
  private readonly warnConnection = createRateLimitedWarn(this.logger)
  private readonly warnFailed = createRateLimitedWarn(this.logger)

  /**
   * @param processEvent - Procesado de una notificación.
   * @param events - Notificaciones (para anotar los fallos).
   * @param queue - Cola `payment-webhooks` (para comprobar que Redis contesta al cerrar).
   */
  constructor(
    @Inject(ProcessWebhookEventCommand)
    private readonly processEvent: ProcessWebhookEventCommand,
    @Inject(PrismaWebhookEventRepository) private readonly events: PrismaWebhookEventRepository,
    @InjectQueue(PAYMENT_WEBHOOKS_QUEUE) private readonly queue: Queue<WebhookJobData>,
  ) {
    super()
  }

  /**
   * Procesa la notificación del job (los jobs con otro nombre se aceptan sin hacer nada).
   *
   * @param job - Job con `{ eventId }`.
   * @throws {TypeError} En español, si el job no trae el id de la notificación (el job falla).
   */
  async process(job: Job<WebhookJobData>): Promise<void> {
    if (job.name !== WEBHOOK_PROCESS_JOB) return
    const eventId: unknown = job.data.eventId
    if (typeof eventId !== 'string' || eventId === '') {
      throw new TypeError(`El job ${String(job.id)} no trae el id de la notificación`)
    }
    try {
      await this.processEvent.execute(eventId)
    } catch (error: unknown) {
      await this.events.recordFailure(eventId, errorMessage(error)).catch(() => undefined)
      throw error
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
    this.warnConnection(`El worker de notificaciones no llega a Redis: ${errorMessage(error)}`)
  }

  /**
   * Avisa (como mucho una vez por minuto) cuando un procesado falla (BullMQ lo reintenta).
   *
   * @param job - Job que falló, si se conoce.
   * @param error - Motivo.
   */
  @OnWorkerEvent('failed')
  onFailed(job: Job<WebhookJobData> | undefined, error: Error): void {
    const eventId = job?.data.eventId ?? 'desconocida'
    this.warnFailed(`No se pudo procesar la notificación ${eventId}: ${errorMessage(error)}`)
  }
}
