import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq'
import { Inject, Logger, type OnModuleDestroy } from '@nestjs/common'
import type { Job, Queue } from 'bullmq'

import { closeWorker } from '../../../shared/infrastructure/redis/close-worker'
import {
  createRateLimitedWarn,
  errorMessage,
} from '../../../shared/infrastructure/redis/rate-limited-warn'
import { ProcessWebhookEventCommand } from '../application/commands/process-webhook-event.command'
import {
  PAYMENT_WEBHOOKS_QUEUE,
  WEBHOOK_PROCESS_JOB,
  type WebhookJobData,
} from './payment-webhooks.queue'
import { PrismaWebhookEventRepository } from './prisma-webhook-event.repository'

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
