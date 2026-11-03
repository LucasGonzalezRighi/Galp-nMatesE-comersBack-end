import { InjectQueue } from '@nestjs/bullmq'
import { Inject, Injectable, Logger } from '@nestjs/common'
import type { Queue } from 'bullmq'

import { ENV, type Env } from '../../../config/env'
import {
  type OutboxEventHandler,
  OutboxHandlerRegistry,
} from '../../../shared/infrastructure/outbox/outbox-handler.registry'
import type { OutboxJobData } from '../../../shared/infrastructure/outbox/outbox.relay'
import { STOREFRONT_EVENT_TYPES, storefrontTagsFor } from '../domain/storefront-tags'
import {
  STOREFRONT_REVALIDATE_JOB,
  STOREFRONT_REVALIDATE_JOB_OPTIONS,
  STOREFRONT_REVALIDATE_QUEUE,
  type StorefrontRevalidateJobData,
} from './storefront-revalidate.queue'

/** Aviso al arrancar sin `STORE_REVALIDATE_SECRET`. */
export const NO_STORE_SECRET_WARNING =
  'Sin STORE_REVALIDATE_SECRET la tienda no se entera de los cambios: se regenera por tiempo'

/**
 * Handler del outbox que le avisa a la tienda: por cada evento que le importa (hoy
 * `combo.changed`) encola un job `storefront.revalidate` con las etiquetas a regenerar y
 * `jobId` = id del evento (un reintento del outbox no duplica el aviso). Solo encola: el HTTP va
 * en la cola `storefront-revalidate`, así una tienda caída no hace reintentar a los demás
 * handlers del evento. Sin `STORE_REVALIDATE_SECRET` no encola nada (lo avisa una vez al
 * arrancar) y la tienda se pone al día sola por tiempo.
 */
@Injectable()
export class StorefrontOutboxHandler implements OutboxEventHandler {
  private readonly logger = new Logger(StorefrontOutboxHandler.name)
  private readonly enabled: boolean

  /**
   * Se registra en el outbox para cada tipo de evento que le avisa algo a la tienda.
   *
   * @param registry - Registro de handlers del outbox.
   * @param queue - Cola `storefront-revalidate`.
   * @param env - Variables de entorno (solo se mira si hay secreto; nunca se loguea).
   */
  constructor(
    registry: OutboxHandlerRegistry,
    @InjectQueue(STOREFRONT_REVALIDATE_QUEUE)
    private readonly queue: Queue<StorefrontRevalidateJobData>,
    @Inject(ENV) env: Pick<Env, 'STORE_REVALIDATE_SECRET'>,
  ) {
    this.enabled = env.STORE_REVALIDATE_SECRET !== undefined
    if (!this.enabled) this.logger.warn(NO_STORE_SECRET_WARNING)
    for (const type of STOREFRONT_EVENT_TYPES) registry.register(type, this)
  }

  /**
   * Encola el aviso a la tienda del evento, si corresponde.
   *
   * @param event - Evento del outbox.
   * @throws Si Redis no acepta el job (el job del outbox falla y se reintenta).
   */
  async handle(event: OutboxJobData): Promise<void> {
    if (!this.enabled) return
    const tags = storefrontTagsFor(event.type, event.payload)
    if (tags.length === 0) return
    await this.queue.add(
      STOREFRONT_REVALIDATE_JOB,
      { eventId: event.id, eventType: event.type, tags },
      { ...STOREFRONT_REVALIDATE_JOB_OPTIONS, jobId: event.id },
    )
  }
}
