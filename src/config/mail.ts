import type { Env } from './env.schema'

/** Mensaje de `parseEnv` cuando `MAIL_MODE=smtp` y falta alguna variable del servidor. */
export const MAIL_SMTP_MISSING_MESSAGE =
  'Con MAIL_MODE=smtp hacen falta SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS y MAIL_FROM.'

/** Mensaje de `parseEnv` cuando `NODE_ENV=production` y `MAIL_MODE` no es `smtp`. */
export const MAIL_PRODUCTION_LOG_MESSAGE =
  'En producción MAIL_MODE tiene que ser smtp (los mails del pedido son obligatorios).'

/** Datos del servidor SMTP, ya revisados. */
export interface SmtpSettings {
  /** Servidor. */
  host: string
  /** Puerto (465 abre TLS directo; los demás, STARTTLS si el servidor lo ofrece). */
  port: number
  /** Usuario. */
  user: string
  /** Contraseña (nunca se loguea). */
  pass: string
  /** Remitente, por ejemplo `Galpón Mates <hola@galpon.com.ar>`. */
  from: string
}

/**
 * Junta las variables del servidor SMTP.
 *
 * @param env - Variables de entorno ya validadas.
 * @returns Los datos del servidor.
 * @throws {Error} En español ({@link MAIL_SMTP_MISSING_MESSAGE}), si falta alguna (`parseEnv` ya
 *   lo impide con `MAIL_MODE=smtp`; esto cubre una configuración armada a mano).
 */
export function smtpSettings(
  env: Pick<Env, 'SMTP_HOST' | 'SMTP_PORT' | 'SMTP_USER' | 'SMTP_PASS' | 'MAIL_FROM'>,
): SmtpSettings {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM } = env
  if (!SMTP_HOST || SMTP_PORT === undefined || !SMTP_USER || !SMTP_PASS || !MAIL_FROM) {
    throw new Error(MAIL_SMTP_MISSING_MESSAGE)
  }
  return { host: SMTP_HOST, port: SMTP_PORT, user: SMTP_USER, pass: SMTP_PASS, from: MAIL_FROM }
}
