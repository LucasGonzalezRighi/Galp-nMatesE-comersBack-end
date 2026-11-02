import { Logger } from '@nestjs/common'

import type { Env } from '../../../config/env'
import type { MailerPort, PasswordResetMail } from '../application/ports/mailer.port'

/** Lo que usa {@link LogMailer} de un logger (el `Logger` de Nest, que con pino va a JSON). */
export interface MailLogger {
  /** Registra en nivel `info`: con pino, los campos del objeto van al log y el texto al `msg`. */
  log(fields: object, message: string): void
  /** Registra un aviso. */
  warn(message: string): void
}

/**
 * {@link MailerPort} provisorio hasta que B7 traiga el proveedor: no manda nada y deja el mail en
 * el log (`info` con `{ to, kind: 'password-reset' }`). El enlace completo, que permite cambiar
 * la contraseña, se registra **solo** en `development` y `test`; en `production` se omite y se
 * avisa que falta el proveedor.
 */
export class LogMailer implements MailerPort {
  /**
   * @param nodeEnv - Entorno (`NODE_ENV`).
   * @param logger - Destino del log (por defecto, el `Logger` de Nest).
   */
  constructor(
    private readonly nodeEnv: Env['NODE_ENV'],
    private readonly logger: MailLogger = new Logger(LogMailer.name),
  ) {}

  /**
   * {@inheritDoc MailerPort.sendPasswordReset}
   *
   * @throws {TypeError} En español, si falta el destinatario o el enlace.
   */
  sendPasswordReset(input: PasswordResetMail): Promise<void> {
    if (input.to.trim() === '') {
      return Promise.reject(new TypeError('El mail de recuperación necesita destinatario'))
    }
    if (input.link.trim() === '') {
      return Promise.reject(new TypeError('El mail de recuperación necesita el enlace'))
    }
    const fields = { to: input.to, kind: 'password-reset' as const }
    if (this.nodeEnv === 'production') {
      this.logger.log(fields, 'Mail de recuperación de contraseña sin enviar')
      this.logger.warn(
        'No hay proveedor de mails configurado (llega en B7): el mail de recuperación no salió',
      )
    } else {
      this.logger.log(
        { ...fields, link: input.link },
        'Mail de recuperación de contraseña (solo log, sin proveedor)',
      )
    }
    return Promise.resolve()
  }
}
