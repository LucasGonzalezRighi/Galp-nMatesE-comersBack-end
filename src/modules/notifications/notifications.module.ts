import { BullModule, getQueueToken } from '@nestjs/bullmq'
import { Module } from '@nestjs/common'
import type { Queue } from 'bullmq'

import { ENV, type Env } from '../../config/env'
import { smtpSettings } from '../../config/mail'
import { MAIL_PORT } from '../../shared/application/ports/mail.port'
import { ComposeEventMailQuery } from './application/compose-event-mail.query'
import { MAIL_DATA_READER, type MailDataReader } from './application/ports/mail-data.reader.port'
import { LogMail } from './infrastructure/log-mail.adapter'
import { MailOutboxHandler } from './infrastructure/mail.outbox-handler'
import { MailProcessor } from './infrastructure/mail.processor'
import { MAIL_QUEUE, type MailJobData } from './infrastructure/mail.queue'
import { PrismaMailDataReader } from './infrastructure/prisma-mail-data.reader'
import { QueuedPasswordResetMailer } from './infrastructure/queued-password-reset.mailer'
import { createSmtpTransport, SmtpMail } from './infrastructure/smtp-mail.adapter'

/**
 * Mails de la tienda (B7, LS-6): {@link MailOutboxHandler} encola en `mails` un job por cada
 * evento del outbox que manda mail (pedidos, pagos, envíos, arrepentimiento, contacto y registro)
 * y {@link MailProcessor} lo arma con los datos del momento y lo manda por el `MAIL_PORT` que
 * elige `MAIL_MODE` (`log` o SMTP con `nodemailer`). Exporta {@link QueuedPasswordResetMailer},
 * el `MAILER_PORT` de `identity`, que encola el mail de restablecer contraseña sin pasar por el
 * outbox. La cola usa `enableOfflineQueue: false`, como las demás.
 */
@Module({
  imports: [
    BullModule.registerQueueAsync({
      name: MAIL_QUEUE,
      inject: [ENV],
      useFactory: (env: Env) => ({
        connection: { url: env.REDIS_URL, enableOfflineQueue: false },
      }),
    }),
  ],
  providers: [
    {
      provide: MAIL_PORT,
      useFactory: (env: Env) => {
        if (env.MAIL_MODE === 'log') return new LogMail()
        const settings = smtpSettings(env)
        return new SmtpMail(createSmtpTransport(settings), settings.from)
      },
      inject: [ENV],
    },
    { provide: MAIL_DATA_READER, useClass: PrismaMailDataReader },
    {
      provide: ComposeEventMailQuery,
      useFactory: (reader: MailDataReader, env: Env) =>
        new ComposeEventMailQuery(reader, env.STORE_ORIGIN),
      inject: [MAIL_DATA_READER, ENV],
    },
    {
      provide: QueuedPasswordResetMailer,
      useFactory: (queue: Queue<MailJobData>, reader: MailDataReader, env: Env) =>
        new QueuedPasswordResetMailer(queue, reader, env.STORE_ORIGIN),
      inject: [getQueueToken(MAIL_QUEUE), MAIL_DATA_READER, ENV],
    },
    MailOutboxHandler,
    MailProcessor,
  ],
  exports: [QueuedPasswordResetMailer],
})
export class NotificationsModule {}
