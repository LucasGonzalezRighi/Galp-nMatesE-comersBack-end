import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq'
import { Inject, Logger, type OnModuleDestroy } from '@nestjs/common'
import { type Job, type Queue, UnrecoverableError } from 'bullmq'

import { closeWorker } from '../../../shared/infrastructure/redis/close-worker'
import {
  createRateLimitedWarn,
  errorMessage,
} from '../../../shared/infrastructure/redis/rate-limited-warn'
import { STOREFRONT_PORT, type StorefrontPort } from '../application/ports/storefront.port'
import {
  STOREFRONT_REVALIDATE_QUEUE,
  type StorefrontRevalidateJobData,
} from './storefront-revalidate.queue'

/**
 * Worker de la cola `storefront-revalidate`: cada job le pide a la tienda que regenere sus
 * etiquetas ({@link StorefrontPort}). Si la tienda las regenera, lo loguea; si rechaza el pedido
 * (secreto o etiqueta inválidos, o una redirección), avisa y falla con `UnrecoverableError`
 * (reintentar no lo arregla); si la falla es pasajera, relanza y BullMQ reintenta (8 intentos,
 * backoff exponencial).
 * Si se agotan, la tienda se pone al día sola por tiempo.
 */
@Processor(STOREFRONT_REVALIDATE_QUEUE)
export class StorefrontRevalidateProcessor extends WorkerHost implements OnModuleDestroy {
  private readonly logger = new Logger(StorefrontRevalidateProcessor.name)
  /** Avisos de conexión y de jobs fallidos, cada uno con su propio límite de uno por minuto. */
  private readonly warnConnection = createRateLimitedWarn(this.logger)
  private readonly warnFailed = createRateLimitedWarn(this.logger)

  /**
   * @param storefront - La tienda.
   * @param queue - Cola `storefront-revalidate` (para comprobar que Redis contesta al cerrar).
   */
  constructor(
    @Inject(STOREFRONT_PORT) private readonly storefront: StorefrontPort,
    @InjectQueue(STOREFRONT_REVALIDATE_QUEUE)
    private readonly queue: Queue<StorefrontRevalidateJobData>,
  ) {
    super()
    this.queue.on('error', (error: Error) => {
      this.warnConnection(`La cola de avisos a la tienda no llega a Redis: ${error.message}`)
    })
  }

  /**
   * Le pide a la tienda que regenere las etiquetas del job.
   *
   * @param job - Job con `{ eventId, eventType, tags }`.
   * @throws {UnrecoverableError} En español, si la tienda rechaza el pedido (sin reintentos).
   * @throws Lo que lance el puerto en una falla pasajera (BullMQ reintenta).
   */
  async process(job: Job<StorefrontRevalidateJobData>): Promise<void> {
    const { eventType, tags } = job.data
    const result = await this.storefront.revalidate(tags)
    if (result.kind === 'revalidated') {
      this.logger.log(`La tienda regeneró ${tags.join(', ')} (evento ${eventType})`)
      return
    }
    const message = `La tienda rechazó regenerar ${tags.join(', ')} (evento ${eventType}, ${String(result.status)}): ${result.reason}`
    this.logger.warn(message)
    throw new UnrecoverableError(message)
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
    this.warnConnection(`El worker de avisos a la tienda no llega a Redis: ${errorMessage(error)}`)
  }

  /**
   * Avisa (como mucho una vez por minuto) cuando un aviso a la tienda falla y se va a reintentar.
   * Un rechazo de la tienda ya se avisó en {@link process}.
   *
   * @param job - Job que falló, si se conoce.
   * @param error - Motivo.
   */
  @OnWorkerEvent('failed')
  onFailed(job: Job<StorefrontRevalidateJobData> | undefined, error: Error): void {
    if (error instanceof UnrecoverableError) return
    const eventType = job?.data.eventType ?? 'desconocido'
    const jobId = job?.id ?? 'desconocido'
    this.warnFailed(
      `No se pudo avisar a la tienda del evento ${eventType} (job ${jobId}): ${errorMessage(error)}`,
    )
  }
}
