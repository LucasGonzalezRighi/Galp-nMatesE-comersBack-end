import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq'
import { Inject, Logger, type OnModuleDestroy } from '@nestjs/common'
import type { Job, Queue } from 'bullmq'

import { closeWorker } from '../../../shared/infrastructure/redis/close-worker'
import {
  createRateLimitedWarn,
  errorMessage,
} from '../../../shared/infrastructure/redis/rate-limited-warn'
import { ExpireOrdersCommand } from '../application/commands/expire-orders.command'
import { ORDER_EXPIRATION_QUEUE, type OrderExpireJobData } from './order-expiration.queue'

/**
 * Worker de la cola `order-expiration`: cada job `order.expire` vence su pedido con
 * {@link ExpireOrdersCommand.expireOne} (idempotente: si ya lo venció el barrido o una lectura,
 * o si se pagó, no hace nada). Si falla, BullMQ lo reintenta (5 intentos, backoff exponencial).
 * El worker arranca con `app.init()`: el contrato, que no inicia la app, no lo crea.
 */
@Processor(ORDER_EXPIRATION_QUEUE)
export class OrderExpirationProcessor extends WorkerHost implements OnModuleDestroy {
  private readonly logger = new Logger(OrderExpirationProcessor.name)
  /** Avisos de conexión y de jobs fallidos, cada uno con su propio límite de uno por minuto. */
  private readonly warnConnection = createRateLimitedWarn(this.logger)
  private readonly warnFailed = createRateLimitedWarn(this.logger)

  /**
   * @param expire - Vencimiento de pedidos.
   * @param queue - Cola `order-expiration` (para comprobar que Redis contesta al cerrar).
   */
  constructor(
    @Inject(ExpireOrdersCommand) private readonly expire: ExpireOrdersCommand,
    @InjectQueue(ORDER_EXPIRATION_QUEUE) private readonly queue: Queue<OrderExpireJobData>,
  ) {
    super()
  }

  /**
   * Vence el pedido del job.
   *
   * @param job - Job con `{ orderId }`.
   * @returns `true` si lo venció, `false` si no correspondía.
   * @throws {TypeError} En español, si el job no trae el id del pedido (el job falla).
   */
  async process(job: Job<OrderExpireJobData>): Promise<boolean> {
    const orderId: unknown = job.data.orderId
    if (typeof orderId !== 'string' || orderId === '') {
      throw new TypeError(`El job ${String(job.id)} no trae el id del pedido a vencer`)
    }
    return (await this.expire.expireOne(orderId)) !== null
  }

  /**
   * Cierra el worker antes que el resto de la app. Con Redis caído, el cierre normal de BullMQ
   * espera para siempre a que termine el bucle del worker (y `app.close()` queda colgado); por eso,
   * si Redis no contesta a tiempo, lo cierra forzado ({@link closeWorker}): el job en curso, si lo
   * hay, queda estancado y se reintenta (vencer es idempotente). Sin `app.init()` no hay worker y
   * no hace nada.
   */
  async onModuleDestroy(): Promise<void> {
    await closeWorker(this, this.queue)
  }

  /**
   * Avisa (como mucho una vez por minuto) cuando el worker no llega a Redis. Tiene su propio
   * límite: un aviso de conexión no tapa el de un job fallido.
   *
   * @param error - Error de la conexión.
   */
  @OnWorkerEvent('error')
  onError(error: Error): void {
    this.warnConnection(`El worker de vencimientos no llega a Redis: ${errorMessage(error)}`)
  }

  /**
   * Avisa (como mucho una vez por minuto) cuando un intento de vencer un pedido falla (BullMQ lo
   * reintenta). Si BullMQ no sabe de qué job fue, dice "desconocido".
   *
   * @param job - Job que falló, si se conoce.
   * @param error - Motivo.
   */
  @OnWorkerEvent('failed')
  onFailed(job: Job<OrderExpireJobData> | undefined, error: Error): void {
    const orderId = job?.data.orderId ?? 'desconocido'
    const jobId = job?.id ?? 'desconocido'
    this.warnFailed(`No se pudo vencer el pedido ${orderId} (job ${jobId}): ${errorMessage(error)}`)
  }
}
