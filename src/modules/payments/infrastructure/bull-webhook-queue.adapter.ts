import { InjectQueue } from '@nestjs/bullmq'
import { Injectable, Logger } from '@nestjs/common'
import type { Queue } from 'bullmq'

import {
  createRateLimitedWarn,
  errorMessage,
} from '../../../shared/infrastructure/redis/rate-limited-warn'
import type { WebhookQueuePort } from '../application/ports/webhook-queue.port'
import {
  PAYMENT_WEBHOOKS_QUEUE,
  WEBHOOK_JOB_OPTIONS,
  WEBHOOK_PROCESS_JOB,
  type WebhookJobData,
} from './payment-webhooks.queue'

/**
 * {@link WebhookQueuePort} con BullMQ: encola `webhook.process` en `payment-webhooks` con
 * `jobId` = id de la notificación (encolarla dos veces no duplica el job). **Falla abierta**: la
 * cola usa `enableOfflineQueue: false`, así que con Redis caído `add` falla al instante; se avisa
 * (como mucho una vez por minuto), se devuelve `false` y el caso de uso procesa en línea.
 */
@Injectable()
export class BullWebhookQueue implements WebhookQueuePort {
  private readonly logger = new Logger(BullWebhookQueue.name)
  private readonly warn = createRateLimitedWarn(this.logger)
  private readonly warnConnection = createRateLimitedWarn(this.logger)

  /** @param queue - Cola `payment-webhooks` de BullMQ. */
  constructor(@InjectQueue(PAYMENT_WEBHOOKS_QUEUE) private readonly queue: Queue<WebhookJobData>) {
    this.queue.on('error', (error: Error) => {
      this.warnConnection(`La cola de notificaciones no llega a Redis: ${error.message}`)
    })
  }

  /** {@inheritDoc WebhookQueuePort.enqueue} */
  async enqueue(eventId: string): Promise<boolean> {
    if (eventId === '') {
      this.warn('Se intentó encolar una notificación sin id')
      return false
    }
    try {
      await this.queue.add(
        WEBHOOK_PROCESS_JOB,
        { eventId },
        { ...WEBHOOK_JOB_OPTIONS, jobId: eventId },
      )
      return true
    } catch (error: unknown) {
      this.warn(
        `No se pudo encolar la notificación ${eventId}; se procesa en línea: ${errorMessage(error)}`,
      )
      return false
    }
  }
}
