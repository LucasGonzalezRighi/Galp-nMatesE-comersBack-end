import type { SessionPort } from '../../../../shared/application/ports/session.port'
import type { Clock } from '../../../../shared/domain/clock'
import { authenticate, type Credentials, rotateSession } from '../authentication'
import type { CustomerRepository } from '../ports/customer.repository.port'
import type { LoginAttemptsPort } from '../ports/login-attempts.port'
import type { PasswordHasher } from '../ports/password-hasher.port'
import type { UserRepository } from '../ports/user.repository.port'
import { toCustomerView } from '../views'
import type { CustomerSessionResult } from './register-customer.command'

/** Inicio de sesión de un cliente en la tienda: rota la sesión (la anónima del CSRF se cierra). */
export class LoginCustomerCommand {
  /**
   * @param users - Usuarios.
   * @param customers - Clientes.
   * @param hasher - Hash de contraseñas.
   * @param attempts - Intentos fallidos por email.
   * @param sessions - Almacén de sesiones.
   * @param clock - Reloj, para `lastLoginAt`.
   */
  constructor(
    private readonly users: UserRepository,
    private readonly customers: CustomerRepository,
    private readonly hasher: PasswordHasher,
    private readonly attempts: LoginAttemptsPort,
    private readonly sessions: SessionPort,
    private readonly clock: Clock,
  ) {}

  /**
   * @param credentials - Email y contraseña.
   * @param currentSessionId - Id de la sesión actual, o `null`.
   * @returns El cliente y su sesión nueva.
   * @throws {InvalidCredentialsError} Si el email no es de un cliente activo o la contraseña no
   *   coincide (sin decir cuál).
   * @throws {LoginLockedError} Si el email está bloqueado por intentos fallidos.
   * @throws {Error} En español, si la cuenta no tiene cliente (dato inconsistente).
   */
  async execute(
    credentials: Credentials,
    currentSessionId: string | null,
  ): Promise<CustomerSessionResult> {
    const { users, hasher, attempts, clock } = this
    const user = await authenticate({ users, hasher, attempts, clock }, credentials, 'customer')
    const customer = await this.customers.findByUserId(user.id)
    if (customer === null) {
      throw new Error(`La cuenta ${user.id} no tiene un cliente asociado`)
    }
    const session = await rotateSession(this.sessions, currentSessionId, {
      kind: 'customer',
      userId: user.id,
      customerId: customer.id,
    })
    return { customer: toCustomerView(customer), session }
  }
}
