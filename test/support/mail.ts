import type {
  MailPort,
  MailTemplate,
  OutgoingMail,
} from '../../src/shared/application/ports/mail.port'

/** Enlace de restablecer contraseña dentro del texto de un mail. */
const RESET_LINK = /https?:\/\/\S+\/cuenta\/restablecer\?token=\S+/

/**
 * {@link MailPort} de los E2E (`createApp({ mailer })`): guarda los mails en memoria en vez de
 * mandarlos. Con {@link failWith} simula un servidor de mails que rechaza todo.
 */
export class RecordingMailPort implements MailPort {
  /** Mails "enviados", en orden. */
  readonly sent: OutgoingMail[] = []
  /** Intentos de envío, incluidos los que fallaron. */
  attempts = 0
  /** Si no es `null`, cada envío falla con este error (SMTP caído). */
  failWith: Error | null = null
  /**
   * Qué correr en cada vuelta de {@link waitFor}: con `NODE_ENV=test` el relay del outbox no
   * corre solo, así que los E2E ponen acá `() => relay.runOnce()`.
   */
  pump: (() => Promise<unknown>) | null = null

  /** {@inheritDoc MailPort.send} */
  send(mail: OutgoingMail): Promise<void> {
    this.attempts += 1
    if (this.failWith !== null) return Promise.reject(this.failWith)
    this.sent.push({ ...mail })
    return Promise.resolve()
  }

  /**
   * Mails de una plantilla, opcionalmente a un destinatario.
   *
   * @param template - Plantilla.
   * @param to - Destinatario (sin importar mayúsculas).
   */
  of(template: MailTemplate, to?: string): OutgoingMail[] {
    return this.sent.filter(
      (mail) =>
        mail.template === template &&
        (to === undefined || mail.to.toLowerCase() === to.toLowerCase()),
    )
  }

  /**
   * Espera a que llegue un mail de una plantilla (corriendo {@link pump} en cada vuelta).
   *
   * @param template - Plantilla.
   * @param to - Destinatario.
   * @param timeoutMs - Cuánto esperar como mucho.
   * @returns El último mail de esa plantilla a ese destinatario.
   * @throws {Error} Si no llega a tiempo.
   */
  async waitFor(template: MailTemplate, to?: string, timeoutMs = 15_000): Promise<OutgoingMail> {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const mail = this.of(template, to).at(-1)
      if (mail !== undefined) return mail
      await this.pump?.()
      if (Date.now() > deadline) {
        throw new Error(`No llegó el mail ${template}${to === undefined ? '' : ` a ${to}`}`)
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }

  /**
   * El enlace de restablecer contraseña de un mail.
   *
   * @param mail - Mail `password-reset`.
   * @returns El enlace, o `''` si no lo tiene.
   */
  static resetLink(mail: OutgoingMail | undefined): string {
    return RESET_LINK.exec(mail?.text ?? '')?.[0] ?? ''
  }
}
