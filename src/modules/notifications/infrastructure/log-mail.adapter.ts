import { Logger } from '@nestjs/common'

import type { MailPort, OutgoingMail } from '../../../shared/application/ports/mail.port'
import { maskEmail } from '../domain/mail-layout'

/** Lo que usa {@link LogMail} de un logger (el `Logger` de Nest, que con pino va a JSON). */
export interface MailLogger {
  /** Registra en nivel `info`: con pino, los campos del objeto van al log y el texto al `msg`. */
  log(fields: object, message: string): void
}

/**
 * {@link MailPort} de `MAIL_MODE=log` (desarrollo y tests): no manda nada y deja en el log la
 * plantilla y el destinatario enmascarado (`l***@dominio.com`). Nunca escribe el email entero, el
 * asunto ni el cuerpo (el de restablecer contraseña lleva el enlace con el token).
 */
export class LogMail implements MailPort {
  /** @param logger - Destino del log (por defecto, el `Logger` de Nest). */
  constructor(private readonly logger: MailLogger = new Logger(LogMail.name)) {}

  /**
   * {@inheritDoc MailPort.send}
   *
   * @throws {TypeError} En español, si falta el destinatario.
   */
  send(mail: OutgoingMail): Promise<void> {
    if (mail.to.trim() === '') return Promise.reject(new TypeError('El mail necesita destinatario'))
    this.logger.log(
      { to: maskEmail(mail.to), template: mail.template },
      `Mail ${mail.template} sin enviar (MAIL_MODE=log)`,
    )
    return Promise.resolve()
  }
}
