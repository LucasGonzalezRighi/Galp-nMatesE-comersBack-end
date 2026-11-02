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

/** Cambio de la contraseña del admin: exige la actual y deja viva la sesión. */
export class ChangeAdminPasswordCommand {
  /**
   * @param users - Usuarios.
   * @param hasher - Hash de contraseñas.
   */
  constructor(
    private readonly users: UserRepository,
    private readonly hasher: PasswordHasher,
  ) {}

  /**
   * @param userId - Usuario de la sesión de admin.
   * @param input - Contraseña actual y nueva.
   * @returns `ok` si cambió; `err('wrong_current_password')` si la actual no coincide.
   * @throws {StaleSessionError} Si el usuario ya no existe, no es admin o está deshabilitado.
   */
  async execute(
    userId: string,
    input: ChangeAdminPasswordInput,
  ): Promise<Result<void, 'wrong_current_password'>> {
    const user = await this.users.findById(userId)
    if (user?.role !== 'admin' || user.status !== 'active') {
      throw new StaleSessionError()
    }
    if (!(await this.hasher.verify(user.passwordHash, input.currentPassword))) {
      return err('wrong_current_password')
    }
    await this.users.updatePassword(user.id, await this.hasher.hash(input.newPassword))
    return ok(undefined)
  }
}
