import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq'
import { Logger, type OnModuleDestroy } from '@nestjs/common'
import type { Job, Queue } from 'bullmq'

import { closeWorker } from '../redis/close-worker'
import { createRateLimitedWarn, errorMessage } from '../redis/rate-limited-warn'
import { OutboxHandlerRegistry } from './outbox-handler.registry'
import { OUTBOX_QUEUE, type OutboxJobData } from './outbox.relay'

/**
 * Único consumidor de la cola `outbox` (BullMQ le da cada job a un solo worker, así que dos
 * processors de la misma cola se repartirían los eventos). Despacha por `job.name` (el `type` del
 * evento) a los handlers de {@link OutboxHandlerRegistry}, uno detrás del otro: un tipo sin
 * handlers termina sin hacer nada y, si un handler lanza, el job falla y BullMQ lo reintenta con
 * `OUTBOX_JOB_OPTIONS` (corren otra vez todos los handlers del tipo).
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
   */
  constructor(
    private readonly registry: OutboxHandlerRegistry,
    @InjectQueue(OUTBOX_QUEUE) private readonly queue: Queue<OutboxJobData>,
  ) {
    super()
    this.queue.on('error', (error: Error) => {
      this.warnConnection(`La cola del outbox no llega a Redis: ${error.message}`)
    })
  }

  /**
   * Despacha un evento del outbox a sus handlers, en orden.
   *
   * @param job - Job con el evento (`job.name` = tipo).
   * @throws Lo que lance un handler (el job falla y se reintenta).
   */
  async process(job: Job<OutboxJobData>): Promise<void> {
    for (const handler of this.registry.handlersFor(job.name)) {
      await handler.handle(job.data)
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
   * Avisa (como mucho una vez por minuto) cuando un evento no se pudo despachar (BullMQ lo
   * reintenta).
   *
   * @param job - Job que falló, si se conoce.
   * @param error - Motivo.
   */
  @OnWorkerEvent('failed')
  onFailed(job: Job<OutboxJobData> | undefined, error: Error): void {
    const name = job?.name ?? 'desconocido'
    const jobId = job?.id ?? 'desconocido'
    this.warnFailed(`No se pudo despachar el evento ${name} (job ${jobId}): ${errorMessage(error)}`)
  }
}
