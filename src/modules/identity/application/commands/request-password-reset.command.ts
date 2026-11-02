import type { SecretsPort } from '../../../../shared/application/ports/secrets.port'
import type { Clock } from '../../../../shared/domain/clock'
import { normalizeEmail } from '../../domain/email'
import type { CustomerRepository } from '../ports/customer.repository.port'
import type { MailerPort } from '../ports/mailer.port'
import type { PasswordResetRepository } from '../ports/password-reset.repository.port'
import type { UserRepository } from '../ports/user.repository.port'

/** Vigencia de un token de recuperación: 60 minutos. */
export const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000

/** Prefijo de los tokens de recuperación (`rt_` + 64 hex). */
export const PASSWORD_RESET_TOKEN_PREFIX = 'rt_'

/**
 * Pedido de cambio de contraseña: si el email es de un cliente activo, guarda el SHA-256 de un
 * token nuevo y le manda el enlace a la tienda. Si no, no hace nada: la respuesta es la misma
 * (`202`) exista o no la cuenta.
 */
export class RequestPasswordResetCommand {
  private readonly storeOrigin: string

  /**
   * @param users - Usuarios.
   * @param customers - Clientes (para el nombre del saludo).
   * @param resets - Tokens de recuperación.
   * @param mailer - Envío del mail.
   * @param secrets - Token aleatorio y SHA-256.
   * @param clock - Reloj, para el vencimiento.
   * @param storeOrigin - Origen de la tienda (`STORE_ORIGIN`), por ejemplo `http://localhost:3000`.
   * @throws {TypeError} En español, si `storeOrigin` no es una URL http o https.
   */
  constructor(
    private readonly users: UserRepository,
    private readonly customers: CustomerRepository,
    private readonly resets: PasswordResetRepository,
    private readonly mailer: MailerPort,
    private readonly secrets: SecretsPort,
    private readonly clock: Clock,
    storeOrigin: string,
  ) {
    const origin = storeOrigin.trim().replace(/\/+$/, '')
    if (!/^https?:\/\/\S+$/.test(origin)) {
      throw new TypeError(
        `El origen de la tienda tiene que ser una URL http o https: "${storeOrigin}"`,
      )
    }
    this.storeOrigin = origin
  }

  /**
   * @param rawEmail - Email tal como llegó (se normaliza).
   * @throws {TypeError} En español, si el email queda vacío. Nunca lanza porque la cuenta no
   *   exista.
   */
  async execute(rawEmail: string): Promise<void> {
    const email = normalizeEmail(rawEmail)
    const user = await this.users.findByEmail(email)
    if (user?.role !== 'customer' || user.status !== 'active') return
    const customer = await this.customers.findByUserId(user.id)
    if (customer === null) return

    const token = `${PASSWORD_RESET_TOKEN_PREFIX}${this.secrets.token(32)}`
    await this.resets.create({
      userId: user.id,
      tokenHash: this.secrets.sha256(token),
      expiresAt: new Date(this.clock.now().getTime() + PASSWORD_RESET_TTL_MS),
    })
    await this.mailer.sendPasswordReset({
      to: user.email,
      firstName: customer.firstName,
      link: `${this.storeOrigin}/cuenta/restablecer?token=${token}`,
    })
  }
}
