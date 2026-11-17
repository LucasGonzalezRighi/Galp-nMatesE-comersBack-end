import { InjectQueue } from '@nestjs/bullmq'
import { Injectable } from '@nestjs/common'
import type { Queue } from 'bullmq'

import {
  type OutboxEventHandler,
  OutboxHandlerRegistry,
} from '../../../shared/infrastructure/outbox/outbox-handler.registry'
import type { OutboxJobData } from '../../../shared/infrastructure/outbox/outbox.relay'
import { MAIL_EVENT_TEMPLATES, mailTemplateFor } from '../application/compose-event-mail.query'
import { MAIL_JOB, MAIL_JOB_OPTIONS, MAIL_QUEUE, type MailJobData, mailJobId } from './mail.queue'

/**
 * Handler del outbox de los mails: por cada evento que manda mail (los de
 * `MAIL_EVENT_TEMPLATES`) encola un job `mail.send` con el id del evento, su tipo, la plantilla y
 * el payload (solo ids), con `jobId` = id del evento + plantilla: un evento repetido no manda dos
 * mails. Solo encola; el SMTP va en la cola `mails`, así un servidor de mails caído no hace
 * reintentar a los demás handlers del evento ni frena la compra.
 */
@Injectable()
export class MailOutboxHandler implements OutboxEventHandler {
  /**
   * Se registra en el outbox para cada tipo de evento que manda mail.
   *
   * @param registry - Registro de handlers del outbox.
   * @param queue - Cola `mails`.
   */
  constructor(
    registry: OutboxHandlerRegistry,
    @InjectQueue(MAIL_QUEUE) private readonly queue: Pick<Queue<MailJobData>, 'add'>,
  ) {
    for (const type of Object.keys(MAIL_EVENT_TEMPLATES)) registry.register(type, this)
  }

  /**
   * Encola el mail del evento, si manda uno.
   *
   * @param event - Evento del outbox.
   * @throws Si Redis no acepta el job (el job del outbox falla y se reintenta).
   */
  async handle(event: OutboxJobData): Promise<void> {
    const template = mailTemplateFor(event.type)
    if (template === null) return
    await this.queue.add(
      MAIL_JOB,
      { kind: 'event', eventId: event.id, eventType: event.type, template, payload: event.payload },
      { ...MAIL_JOB_OPTIONS, jobId: mailJobId(event.id, template) },
    )
  }
}
