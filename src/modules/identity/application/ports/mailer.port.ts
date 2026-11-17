/** Mail de recuperación de contraseña. */
export interface PasswordResetMail {
  /** Destinatario. */
  to: string
  /** Nombre para el saludo. */
  firstName: string
  /** Enlace a la tienda con el token (`…/cuenta/restablecer?token=rt_…`). */
  link: string
}

/** Mail de cuenta eliminada (`account-deleted`). */
export interface AccountDeletedMail {
  /** Destinatario: el email que tenía la cuenta, leído antes de borrarla. */
  to: string
  /** Nombre para el saludo (el que tenía la cuenta). */
  firstName: string
}

/** Envío de mails de la cuenta (en la app, la cola `mails` de `notifications`, B7). */
export interface MailerPort {
  /**
   * Manda el mail con el enlace para cambiar la contraseña.
   *
   * @param input - Destinatario, nombre y enlace.
   */
  sendPasswordReset(input: PasswordResetMail): Promise<void>

  /**
   * Manda el aviso de que la cuenta se eliminó. Nunca lanza: la cuenta ya se borró, así que si el
   * mail no se puede encolar se registra un `warn` sin datos personales.
   *
   * @param input - Destinatario y nombre.
   */
  sendAccountDeleted(input: AccountDeletedMail): Promise<void>
}

/** Token de inyección del {@link MailerPort}. */
export const MAILER_PORT = Symbol('MAILER_PORT')
