import type { SessionPort } from '../../../../shared/application/ports/session.port'
import { err, ok, type Result } from '../../../../shared/domain/result'
import { StaleSessionError } from '../../domain/identity-errors'
import type { PasswordHasher } from '../ports/password-hasher.port'
import type { UserRepository } from '../ports/user.repository.port'

/** Contraseña actual y nueva del admin (la confirmación la valida la interfaz). */
export interface ChangeAdminPasswordInput {
  /** Contraseña actual. */
  currentPassword: string
  /** Contraseña nueva. */
  newPassword: string
}

/**
 * Cambio de la contraseña del admin: exige la actual, cierra todas sus otras sesiones (NV-32) y
 * deja viva, renovada, la sesión desde la que se cambió (mismo id, CSRF y vencimiento).
 */
export class ChangeAdminPasswordCommand {
  /**
   * @param users - Usuarios.
   * @param hasher - Hash de contraseñas.
   * @param sessions - Almacén de sesiones.
   */
  constructor(
    private readonly users: UserRepository,
    private readonly hasher: PasswordHasher,
    private readonly sessions: SessionPort,
  ) {}

  /**
   * @param userId - Usuario de la sesión de admin.
   * @param input - Contraseña actual y nueva.
   * @param currentSessionId - Id de la sesión desde la que se cambia (la que sigue valiendo).
   * @returns `ok` si cambió; `err('wrong_current_password')` si la actual no coincide.
   * @throws {StaleSessionError} Si el usuario ya no existe, no es admin o está deshabilitado.
   * @throws {DomainError} 503 si el almacén de sesiones no responde (la contraseña ya cambió).
   */
  async execute(
    userId: string,
    input: ChangeAdminPasswordInput,
    currentSessionId: string,
  ): Promise<Result<void, 'wrong_current_password'>> {
    const user = await this.users.findById(userId)
    if (user?.role !== 'admin' || user.status !== 'active') {
      throw new StaleSessionError()
    }
    if (!(await this.hasher.verify(user.passwordHash, input.currentPassword))) {
      return err('wrong_current_password')
    }
    await this.users.updatePassword(user.id, await this.hasher.hash(input.newPassword))
    await this.sessions.destroyAllForUser(user.id, { keep: currentSessionId })
    return ok(undefined)
  }
}
