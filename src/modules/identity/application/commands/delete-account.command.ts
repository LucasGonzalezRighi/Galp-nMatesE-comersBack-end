import type { SessionPort } from '../../../../shared/application/ports/session.port'
import { err, ok, type Result } from '../../../../shared/domain/result'
import { normalizeEmail } from '../../domain/email'
import { LoginLockedError, StaleSessionError } from '../../domain/identity-errors'
import type { AccountDeletionRepository } from '../ports/account-deletion.port'
import type { CustomerRepository } from '../ports/customer.repository.port'
import type { LoginAttemptsPort } from '../ports/login-attempts.port'
import type { MailerPort } from '../ports/mailer.port'
import type { PasswordHasher } from '../ports/password-hasher.port'
import type { UserRepository } from '../ports/user.repository.port'

/** Confirmación de la baja (`AccountDeletion` del contrato). */
export interface DeleteAccountInput {
  /** Contraseña actual, en claro. */
  password: string
}

/** Contexto del pedido HTTP de la baja. */
export interface DeleteAccountContext {
  /**
   * Cliente que pide la baja (su IPv4 o la red /64 de su IPv6): las contraseñas equivocadas
   * cuentan para el mismo bloqueo que el inicio de sesión.
   */
  clientIp: string
}

/**
 * Eliminar la cuenta del cliente (`DELETE /me`, LS-5): confirma la contraseña (cada intento cuenta
 * para el bloqueo del inicio de sesión, por email e IP y por email solo), borra la cuenta con
 * {@link AccountDeletionRepository} (los pedidos quedan sin vínculo), cierra todas las sesiones del
 * usuario y encola el mail `account-deleted` al email que tenía la cuenta, leído antes de borrarla.
 */
export class DeleteAccountCommand {
  /**
   * @param users - Usuarios.
   * @param customers - Clientes.
   * @param accounts - Baja de la cuenta.
   * @param hasher - Hash de contraseñas.
   * @param attempts - Intentos por email e IP y por email solo.
   * @param sessions - Almacén de sesiones.
   * @param mailer - Mails de la cuenta.
   */
  constructor(
    private readonly users: UserRepository,
    private readonly customers: CustomerRepository,
    private readonly accounts: AccountDeletionRepository,
    private readonly hasher: PasswordHasher,
    private readonly attempts: LoginAttemptsPort,
    private readonly sessions: SessionPort,
    private readonly mailer: MailerPort,
  ) {}

  /**
   * @param userId - Usuario de la sesión del cliente.
   * @param input - Contraseña actual.
   * @param context - IP del cliente, para el bloqueo por intentos.
   * @returns `ok` si la cuenta se eliminó; `err('wrong_password')` si la contraseña no coincide
   *   (no cambia nada).
   * @throws {StaleSessionError} Si el usuario ya no existe, no es cliente o está deshabilitado.
   * @throws {LoginLockedError} Si el email está bloqueado por intentos, o si este fallo lo bloquea.
   * @throws {Error} En español, si la cuenta no tiene cliente (dato inconsistente).
   * @throws {DomainError} 503 si el almacén de sesiones no responde (la cuenta ya se borró).
   */
  async execute(
    userId: string,
    input: DeleteAccountInput,
    context: DeleteAccountContext,
  ): Promise<Result<void, 'wrong_password'>> {
    const user = await this.users.findById(userId)
    if (user?.role !== 'customer' || user.status !== 'active') throw new StaleSessionError()

    const key = { email: normalizeEmail(user.email), clientIp: context.clientIp }
    const attempt = await this.attempts.attempt(key)
    if (attempt.blockedForSeconds !== null) {
      throw new LoginLockedError(wholeSeconds(attempt.blockedForSeconds))
    }
    if (!(await this.hasher.verify(user.passwordHash, input.password))) {
      if (attempt.lockedIfFailsSeconds !== null) {
        throw new LoginLockedError(wholeSeconds(attempt.lockedIfFailsSeconds))
      }
      return err('wrong_password')
    }

    const customer = await this.customers.findByUserId(user.id)
    if (customer === null) throw new Error(`La cuenta ${user.id} no tiene un cliente asociado`)

    await this.accounts.deleteAccount({ userId: user.id, customerId: customer.id })
    await this.attempts.clear(key)
    await this.sessions.destroyAllForUser(user.id)
    await this.mailer.sendAccountDeleted({ to: user.email, firstName: customer.firstName })
    return ok(undefined)
  }
}

/** Segundos enteros y positivos para `Retry-After`. */
function wholeSeconds(seconds: number): number {
  return Math.max(1, Math.ceil(seconds))
}
