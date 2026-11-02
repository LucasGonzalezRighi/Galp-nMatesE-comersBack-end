/** Mail de recuperación de contraseña. */
export interface PasswordResetMail {
  /** Destinatario. */
  to: string
  /** Nombre para el saludo. */
  firstName: string
  /** Enlace a la tienda con el token (`…/cuenta/restablecer?token=rt_…`). */
  link: string
}

/** Envío de mails de la cuenta (el proveedor real llega en B7; hasta entonces, un adaptador de log). */
export interface MailerPort {
  /**
   * Manda el mail con el enlace para cambiar la contraseña.
   *
   * @param input - Destinatario, nombre y enlace.
   */
  sendPasswordReset(input: PasswordResetMail): Promise<void>
}

/** Token de inyección del {@link MailerPort}. */
export const MAILER_PORT = Symbol('MAILER_PORT')
