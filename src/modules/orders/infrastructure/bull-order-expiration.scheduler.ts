import { InjectQueue } from '@nestjs/bullmq'
import { Inject, Injectable, Logger } from '@nestjs/common'
import type { Queue } from 'bullmq'

import { CLOCK, type Clock } from '../../../shared/domain/clock'
import {
  createRateLimitedWarn,
  errorMessage,
} from '../../../shared/infrastructure/redis/rate-limited-warn'
import type { OrderExpirationSchedulerPort } from '../application/ports/order-expiration.port'
import {
  ORDER_EXPIRATION_QUEUE,
  ORDER_EXPIRE_JOB,
  ORDER_EXPIRE_JOB_OPTIONS,
  type OrderExpireJobData,
} from './order-expiration.queue'

/**
 * Programa el vencimiento de cada pedido como un job diferido `order.expire` en la cola
 * `order-expiration` (`jobId` = id del pedido: programarlo dos veces no duplica el job). **Falla
 * abierta**: si Redis no responde (la cola usa `enableOfflineQueue: false`, así que falla al
 * instante) lo avisa con `warn`, como mucho una vez por minuto, y el pedido se crea igual; el
 * barrido o la lectura lo vencen después.
 */
@Injectable()
export class BullOrderExpirationScheduler implements OrderExpirationSchedulerPort {
  private readonly logger = new Logger(BullOrderExpirationScheduler.name)
  private readonly warn = createRateLimitedWarn(this.logger)

  /**
   * @param queue - Cola `order-expiration` de BullMQ.
   * @param clock - Reloj de la app (para calcular el `delay`).
   */
  constructor(
    @InjectQueue(ORDER_EXPIRATION_QUEUE) private readonly queue: Queue<OrderExpireJobData>,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {
    this.queue.on('error', (error: Error) => {
      this.warn(`La cola de vencimientos no llega a Redis: ${error.message}`)
    })
  }

  /**
   * {@inheritDoc OrderExpirationSchedulerPort.schedule}
   *
   * Solo lanza ante argumentos inválidos (errores de programación), nunca porque Redis falle.
   *
   * @throws {TypeError} En español, si el id está vacío o la fecha no es válida.
   */
  async schedule(orderId: string, at: Date): Promise<void> {
    if (typeof orderId !== 'string' || orderId === '') {
      throw new TypeError('El id del pedido a vencer no puede estar vacío')
    }
    if (!(at instanceof Date) || Number.isNaN(at.getTime())) {
      throw new TypeError('El momento del vencimiento no es una fecha válida')
    }
    const delay = Math.max(0, at.getTime() - this.clock.now().getTime())
    try {
      await this.queue.add(
        ORDER_EXPIRE_JOB,
        { orderId },
        { ...ORDER_EXPIRE_JOB_OPTIONS, delay, jobId: orderId },
      )
    } catch (error) {
      this.warn(`No se pudo programar el vencimiento del pedido ${orderId}: ${errorMessage(error)}`)
    }
  }
}
