import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq'
import { Inject, Logger, type OnModuleDestroy } from '@nestjs/common'
import { type Job, type Queue, UnrecoverableError } from 'bullmq'

import {
  MAIL_PORT,
  type MailPort,
  type OutgoingMail,
} from '../../../shared/application/ports/mail.port'
import { closeWorker } from '../../../shared/infrastructure/redis/close-worker'
import {
  createRateLimitedWarn,
  errorMessage,
} from '../../../shared/infrastructure/redis/rate-limited-warn'
import { ComposeEventMailQuery } from '../application/compose-event-mail.query'
import { maskEmailsIn } from '../domain/mail-layout'
import { MAIL_QUEUE, type MailJobData } from './mail.queue'

/** Plantilla de un job, para los logs (nunca el destinatario ni el cuerpo). */
function templateOf(data: MailJobData | undefined): string {
  if (data === undefined) return 'desconocido'
  return data.kind === 'direct' ? data.mail.template : data.template
}

/**
 * Worker de la cola `mails`: arma el mail de un evento leyendo los datos en ese momento
 * ({@link ComposeEventMailQuery}) o toma el ya armado (restablecer contraseña) y lo manda por el
 * {@link MailPort} (`log` o SMTP). Si el servidor falla, relanza y BullMQ reintenta (5 intentos,
 * backoff exponencial); agotados, el job queda en fallidos con un `warn` sin datos personales
 * (los emails del error se enmascaran). Un payload roto falla sin reintentos.
 */
@Processor(MAIL_QUEUE)
export class MailProcessor extends WorkerHost implements OnModuleDestroy {
  private readonly logger = new Logger(MailProcessor.name)
  /** Avisos de conexión y de reintentos, cada uno con su propio límite de uno por minuto. */
  private readonly warnConnection = createRateLimitedWarn(this.logger)
  private readonly warnRetry = createRateLimitedWarn(this.logger)

  /**
   * @param mailer - Envío de mails.
   * @param compose - Arma el mail de un evento.
   * @param queue - Cola `mails` (para comprobar que Redis contesta al cerrar).
   */
  constructor(
    @Inject(MAIL_PORT) private readonly mailer: MailPort,
    private readonly compose: ComposeEventMailQuery,
    @InjectQueue(MAIL_QUEUE) private readonly queue: Queue<MailJobData>,
  ) {
    super()
    this.queue.on('error', (error: Error) => {
      this.warnConnection(`La cola de mails no llega a Redis: ${error.message}`)
    })
  }

  /**
   * Arma (si hace falta) y manda el mail del job.
   *
   * @param job - Job `mail.send`.
   * @throws {UnrecoverableError} En español, si el payload del evento está roto (sin reintentos).
   * @throws Lo que lance el {@link MailPort} (BullMQ reintenta).
   */
  async process(job: Job<MailJobData>): Promise<void> {
    const mail = await this.mailOf(job.data)
    if (mail === null) {
      this.logger.log(
        `El mail ${templateOf(job.data)} no sale: el registro ya no existe (job ${job.id ?? '?'})`,
      )
      return
    }
    await this.mailer.send(mail)
  }

  /** El mail del job: el armado o el de su evento. */
  private async mailOf(data: MailJobData): Promise<OutgoingMail | null> {
    if (data.kind === 'direct') return data.mail
    try {
      return await this.compose.execute({ eventType: data.eventType, payload: data.payload })
    } catch (error) {
      if (error instanceof TypeError) throw new UnrecoverableError(error.message)
      throw error
    }
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
    this.warnConnection(`El worker de mails no llega a Redis: ${errorMessage(error)}`)
  }

  /**
   * Avisa cuando un mail falla: si se va a reintentar, como mucho una vez por minuto; si agotó
   * los intentos (o no se puede reintentar), siempre, porque queda en fallidos. Sin datos
   * personales: solo la plantilla, el job y el error con los emails enmascarados.
   *
   * @param job - Job que falló, si se conoce.
   * @param error - Motivo.
   */
  @OnWorkerEvent('failed')
  onFailed(job: Job<MailJobData> | undefined, error: Error): void {
    const template = templateOf(job?.data)
    const jobId = job?.id ?? 'desconocido'
    const reason = maskEmailsIn(errorMessage(error))
    const attempts = job?.opts.attempts ?? 1
    const exhausted = error instanceof UnrecoverableError || (job?.attemptsMade ?? 0) >= attempts
    if (exhausted) {
      this.logger.warn(`El mail ${template} (job ${jobId}) quedó en fallidos: ${reason}`)
      return
    }
    this.warnRetry(`El mail ${template} (job ${jobId}) falló y se reintenta: ${reason}`)
  }
}
