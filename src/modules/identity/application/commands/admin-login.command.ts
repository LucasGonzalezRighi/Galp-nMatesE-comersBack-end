import type { SessionPort, SessionRecord } from '../../../../shared/application/ports/session.port'
import type { Clock } from '../../../../shared/domain/clock'
import { authenticate, type Credentials } from '../authentication'
import type { LoginAttemptsPort } from '../ports/login-attempts.port'
import type { PasswordHasher } from '../ports/password-hasher.port'
import type { UserRepository } from '../ports/user.repository.port'

/** Sesión de admin recién abierta. */
export interface AdminLoginResult {
  /** Email del admin. */
  email: string
  /** Sesión de admin nueva: su id va en la cookie y su CSRF en la respuesta. */
  session: SessionRecord
}

/** Inicio de sesión del admin en el dashboard, con los mismos errores que el del cliente. */
export class AdminLoginCommand {
  /**
   * @param users - Usuarios.
   * @param hasher - Hash de contraseñas.
   * @param attempts - Intentos por email e IP y por email solo.
   * @param sessions - Almacén de sesiones.
   * @param clock - Reloj, para `lastLoginAt`.
   */
  constructor(
    private readonly users: UserRepository,
    private readonly hasher: PasswordHasher,
    private readonly attempts: LoginAttemptsPort,
    private readonly sessions: SessionPort,
    private readonly clock: Clock,
  ) {}

  /**
   * @param credentials - Email, contraseña e IP del cliente.
   * @returns El email y la sesión de admin nueva.
   * @throws {InvalidCredentialsError} Si el email no es de un admin activo o la contraseña no
   *   coincide (sin decir cuál).
   * @throws {LoginLockedError} Si el email está bloqueado para esa IP, o para todas por el tope
   *   por email, por intentos fallidos.
   */
  async execute(credentials: Credentials): Promise<AdminLoginResult> {
    const { users, hasher, attempts, clock } = this
    const { user, authenticatedAt } = await authenticate(
      { users, hasher, attempts, clock },
      credentials,
      'admin',
    )
    const session = await this.sessions.create({
      kind: 'admin',
      userId: user.id,
      customerId: null,
      authenticatedAt,
    })
    return { email: user.email, session }
  }
}
