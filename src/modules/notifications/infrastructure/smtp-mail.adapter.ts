import { createTransport } from 'nodemailer'

import type { SmtpSettings } from '../../../config/mail'
import type { MailPort, OutgoingMail } from '../../../shared/application/ports/mail.port'

/** Lo que usa {@link SmtpMail} de un transporte de `nodemailer`. */
export interface MailTransport {
  /**
   * Manda un mensaje.
   *
   * @param message - Remitente, destinatario, asunto y cuerpos.
   */
  sendMail(message: {
    from: string
    to: string
    subject: string
    text: string
    html: string
  }): Promise<unknown>
}

/** Cuánto espera cada paso de la conexión SMTP antes de fallar (la cola reintenta). */
const SMTP_TIMEOUT_MS = 15_000

/** Servidores de esta máquina: ahí se admite SMTP sin TLS (por ejemplo, Mailpit en desarrollo). */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])

/**
 * Transporte SMTP de `nodemailer` con los datos del servidor: TLS directo en el 465 y STARTTLS
 * obligatorio en los demás puertos (nunca manda la contraseña en claro), salvo en un servidor de
 * esta máquina (`localhost`), donde no se exige.
 *
 * @param settings - Servidor, puerto, usuario y contraseña.
 * @returns El transporte (no abre la conexión hasta el primer envío).
 */
export function createSmtpTransport(settings: SmtpSettings): MailTransport {
  const secure = settings.port === 465
  return createTransport({
    host: settings.host,
    port: settings.port,
    secure,
    requireTLS: !secure && !LOCAL_HOSTS.has(settings.host),
    auth: { user: settings.user, pass: settings.pass },
    connectionTimeout: SMTP_TIMEOUT_MS,
    greetingTimeout: SMTP_TIMEOUT_MS,
    socketTimeout: SMTP_TIMEOUT_MS,
  })
}

/**
 * {@link MailPort} de `MAIL_MODE=smtp`: manda cada mail por el transporte de `nodemailer`, con el
 * remitente de `MAIL_FROM`, en texto plano y HTML. Si el servidor rechaza o no contesta, lanza el
 * error y la cola `mails` reintenta.
 */
export class SmtpMail implements MailPort {
  /**
   * @param transport - Transporte de `nodemailer` ({@link createSmtpTransport}; en los tests, el
   *   de prueba `jsonTransport`).
   * @param from - Remitente (`MAIL_FROM`).
   * @throws {TypeError} En español, si falta el remitente.
   */
  constructor(
    private readonly transport: MailTransport,
    private readonly from: string,
  ) {
    if (from.trim() === '') throw new TypeError('El envío por SMTP necesita el remitente')
  }

  /**
   * {@inheritDoc MailPort.send}
   *
   * @throws {TypeError} En español, si falta el destinatario.
   */
  async send(mail: OutgoingMail): Promise<void> {
    if (mail.to.trim() === '') throw new TypeError('El mail necesita destinatario')
    await this.transport.sendMail({
      from: this.from,
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    })
  }
}
