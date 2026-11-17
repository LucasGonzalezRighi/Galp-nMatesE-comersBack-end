import { Logger } from '@nestjs/common'
import type { Queue } from 'bullmq'

import { newId } from '../../../shared/domain/id'
import type {
  AccountDeletedMail,
  MailerPort,
  PasswordResetMail,
} from '../../identity/application/ports/mailer.port'
import type { MailDataReader } from '../application/ports/mail-data.reader.port'
import { accountDeletedMail, passwordResetMail } from '../domain/account-mails'
import { DIRECT_MAIL_JOB_OPTIONS, MAIL_JOB, type MailJobData } from './mail.queue'

/**
 * {@link MailerPort} de `identity` sobre la cola `mails`: arma los mails `password-reset` y
 * `account-deleted` y los encola directo (no pasan por `outbox_events`, así ni el token ni el email
 * de una cuenta borrada quedan guardados en Postgres); el job se borra apenas sale.
 */
export class QueuedPasswordResetMailer implements MailerPort {
  private readonly storeOrigin: string
  private readonly logger = new Logger('Mails')

  /**
   * @param queue - Cola `mails`.
   * @param reader - Lecturas de los mails (los datos de la tienda para el pie).
   * @param storeOrigin - Origen de la tienda (`STORE_ORIGIN`).
   */
  constructor(
    private readonly queue: Pick<Queue<MailJobData>, 'add'>,
    private readonly reader: Pick<MailDataReader, 'storeInfo'>,
    storeOrigin: string,
  ) {
    this.storeOrigin = storeOrigin.trim().replace(/\/+$/, '')
  }

  /**
   * {@inheritDoc MailerPort.sendPasswordReset}
   *
   * @throws {TypeError} En español, si falta el destinatario o el enlace.
   * @throws Si Redis no acepta el job.
   */
  async sendPasswordReset(input: PasswordResetMail): Promise<void> {
    if (input.to.trim() === '') throw new TypeError('El mail de recuperación necesita destinatario')
    const store = { storeOrigin: this.storeOrigin, ...(await this.reader.storeInfo()) }
    const rendered = passwordResetMail({ firstName: input.firstName, link: input.link }, store)
    await this.queue.add(
      MAIL_JOB,
      { kind: 'direct', mail: { to: input.to, template: 'password-reset', ...rendered } },
      { ...DIRECT_MAIL_JOB_OPTIONS, jobId: `password-reset-${newId()}` },
    )
  }

  /**
   * {@inheritDoc MailerPort.sendAccountDeleted}
   *
   * @throws {TypeError} En español, si falta el destinatario (antes de intentar encolar).
   */
  async sendAccountDeleted(input: AccountDeletedMail): Promise<void> {
    if (input.to.trim() === '')
      throw new TypeError('El aviso de cuenta eliminada necesita destinatario')
    try {
      const store = { storeOrigin: this.storeOrigin, ...(await this.reader.storeInfo()) }
      const rendered = accountDeletedMail({ firstName: input.firstName }, store)
      await this.queue.add(
        MAIL_JOB,
        { kind: 'direct', mail: { to: input.to, template: 'account-deleted', ...rendered } },
        { ...DIRECT_MAIL_JOB_OPTIONS, jobId: `account-deleted-${newId()}` },
      )
    } catch {
      this.logger.warn('No se pudo encolar el aviso de cuenta eliminada (la cuenta ya se borró)')
    }
  }
}
