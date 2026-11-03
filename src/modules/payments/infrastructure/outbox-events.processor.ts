import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq'
import { Inject, Logger, type OnModuleDestroy } from '@nestjs/common'
import type { Job, Queue } from 'bullmq'

import {
  OUTBOX_QUEUE,
  type OutboxJobData,
} from '../../../shared/infrastructure/outbox/outbox.relay'
import {
  createRateLimitedWarn,
  errorMessage,
} from '../../../shared/infrastructure/redis/rate-limited-warn'
import { ORDER_EXPIRED_EVENT } from '../../orders/domain/order-events'
import { OnOrderExpiredCommand } from '../application/commands/on-order-expired.command'
import { closeWorker } from './payment-webhooks.processor'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Consumidor de la cola `outbox` (Ruling B-43): despacha por `job.name` (el `type` del evento).
 * `order.expired` cancela el intento activo del pedido vencido y, con mejor esfuerzo, vence la
 * preferencia o cancela el pago en Mercado Pago ({@link OnOrderExpiredCommand}); el resto de los
 * eventos se aceptan sin hacer nada. Cuando B6/B7 necesiten consumir el outbox, este despacho se
 * extrae a `shared` (cada job lo toma un solo worker de la cola).
 */
@Processor(OUTBOX_QUEUE)
export class OutboxEventsProcessor extends WorkerHost implements OnModuleDestroy {
  private readonly logger = new Logger(OutboxEventsProcessor.name)
  /** Avisos de conexión y de jobs fallidos, cada uno con su propio límite de uno por minuto. */
  private readonly warnConnection = createRateLimitedWarn(this.logger)
  private readonly warnFailed = createRateLimitedWarn(this.logger)

  /**
   * @param onOrderExpired - Cancelación del intento de un pedido vencido.
   * @param queue - Cola `outbox` (para comprobar que Redis contesta al cerrar).
   */
  constructor(
    @Inject(OnOrderExpiredCommand) private readonly onOrderExpired: OnOrderExpiredCommand,
    @InjectQueue(OUTBOX_QUEUE) private readonly queue: Queue<OutboxJobData>,
  ) {
    super()
    this.queue.on('error', (error: Error) => {
      this.warnConnection(`La cola del outbox no llega a Redis: ${error.message}`)
    })
  }

  /**
   * Despacha un evento del outbox.
   *
   * @param job - Job con el evento (`job.name` = tipo).
   * @throws {TypeError} En español, si un `order.expired` no trae el id del pedido (el job falla).
   */
  async process(job: Job<OutboxJobData>): Promise<void> {
    if (job.name !== ORDER_EXPIRED_EVENT) return
    const payload: unknown = isRecord(job.data) ? job.data.payload : undefined
    const orderId = isRecord(payload) ? payload.orderId : undefined
    if (typeof orderId !== 'string' || orderId === '') {
      throw new TypeError(`El evento ${String(job.id)} (order.expired) no trae el id del pedido`)
    }
    await this.onOrderExpired.execute(orderId)
  }

  /** Cierra el worker (forzado si Redis no contesta), como `OrderExpirationProcessor`. */
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
