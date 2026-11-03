import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq'
import { Inject, Logger, type OnModuleDestroy } from '@nestjs/common'
import type { Job, Queue, Worker } from 'bullmq'

import {
  createRateLimitedWarn,
  errorMessage,
} from '../../../shared/infrastructure/redis/rate-limited-warn'
import { ExpireOrdersCommand } from '../application/commands/expire-orders.command'
import { ORDER_EXPIRATION_QUEUE, type OrderExpireJobData } from './order-expiration.queue'

/** Cuánto espera el cierre de la app a que Redis conteste antes de cerrar el worker forzado. */
export const WORKER_SHUTDOWN_PROBE_MS = 1_000

/**
 * Worker de la cola `order-expiration`: cada job `order.expire` vence su pedido con
 * {@link ExpireOrdersCommand.expireOne} (idempotente: si ya lo venció el barrido o una lectura,
 * o si se pagó, no hace nada). Si falla, BullMQ lo reintenta (5 intentos, backoff exponencial).
 * El worker arranca con `app.init()`: el contrato, que no inicia la app, no lo crea.
 */
@Processor(ORDER_EXPIRATION_QUEUE)
export class OrderExpirationProcessor extends WorkerHost implements OnModuleDestroy {
  private readonly logger = new Logger(OrderExpirationProcessor.name)
  private readonly warn = createRateLimitedWarn(this.logger)

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
   * si Redis no contesta en {@link WORKER_SHUTDOWN_PROBE_MS}, lo cierra forzado: el job en curso,
   * si lo hay, queda estancado y se reintenta (vencer es idempotente). Sin `app.init()` no hay
   * worker y no hace nada.
   */
  async onModuleDestroy(): Promise<void> {
    let worker: Worker
    try {
      worker = this.worker
    } catch {
      return
    }
    await worker.close(!(await this.redisAnswers()))
  }

  /**
   * Avisa (como mucho una vez por minuto) cuando el worker no llega a Redis.
   *
   * @param error - Error de la conexión.
   */
  @OnWorkerEvent('error')
  onError(error: Error): void {
    this.warn(`El worker de vencimientos no llega a Redis: ${errorMessage(error)}`)
  }

  /**
   * Avisa cuando un intento de vencer un pedido falla (BullMQ lo reintenta).
   *
   * @param job - Job que falló, si se conoce.
   * @param error - Motivo.
   */
  @OnWorkerEvent('failed')
  onFailed(job: Job<OrderExpireJobData> | undefined, error: Error): void {
    this.warn(`No se pudo vencer el pedido ${String(job?.data.orderId)}: ${errorMessage(error)}`)
  }

  /** Indica si Redis contesta a tiempo (la cola no encola offline: con Redis caído falla al toque). */
  private async redisAnswers(): Promise<boolean> {
    let timer: NodeJS.Timeout | undefined
    const timeout = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => {
        resolve(false)
      }, WORKER_SHUTDOWN_PROBE_MS)
    })
    const probe = this.queue.getJobCounts('delayed').then(
      () => true,
      () => false,
    )
    try {
      return await Promise.race([probe, timeout])
    } finally {
      clearTimeout(timer)
    }
  }
}
