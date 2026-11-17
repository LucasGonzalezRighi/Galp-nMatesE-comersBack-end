import type { MailTemplate } from '../../domain/mail-template'

export { MAIL_TEMPLATES, type MailTemplate } from '../../domain/mail-template'

/** Mail listo para salir: destinatario, asunto y cuerpo en texto plano y HTML simple. */
export interface OutgoingMail {
  /** Destinatario: el email del pedido o de la cuenta, nunca otro. */
  to: string
  /** Asunto. */
  subject: string
  /** Cuerpo en texto plano. */
  text: string
  /** Cuerpo en HTML simple (sin imágenes remotas, píxeles ni enlaces de rastreo). */
  html: string
  /** Plantilla con la que se armó (para los logs; nunca se loguea el cuerpo). */
  template: MailTemplate
}

/** Envío de mails: un adaptador de log (`MAIL_MODE=log`) y uno SMTP (`MAIL_MODE=smtp`). */
export interface MailPort {
  /**
   * Manda un mail.
   *
   * @param mail - El mail armado.
   * @throws Si el servidor lo rechaza o no contesta (la cola lo reintenta).
   */
  send(mail: OutgoingMail): Promise<void>
}

/** Token de inyección del {@link MailPort}. */
export const MAIL_PORT = Symbol('MAIL_PORT')
