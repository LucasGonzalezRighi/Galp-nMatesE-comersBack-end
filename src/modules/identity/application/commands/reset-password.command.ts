import type { SecretsPort } from '../../../../shared/application/ports/secrets.port'
import type { SessionPort } from '../../../../shared/application/ports/session.port'
import type { Clock } from '../../../../shared/domain/clock'
import { err, ok, type Result } from '../../../../shared/domain/result'
import type { PasswordHasher } from '../ports/password-hasher.port'
import type { PasswordResetRepository } from '../ports/password-reset.repository.port'
import type { UserRepository } from '../ports/user.repository.port'

/** Contraseña nueva con el token del enlace (`ResetPasswordInput` del contrato). */
export interface ResetPasswordInput {
  /** Token del enlace (`rt_…`). */
  token: string
  /** Contraseña nueva, en claro (se guarda solo el hash). */
  password: string
}

/**
 * Cambio de contraseña con el token del mail: lo usa (una sola vez), guarda el hash nuevo y cierra
 * todas las sesiones del usuario.
 */
export class ResetPasswordCommand {
  /**
   * @param resets - Tokens de recuperación.
   * @param users - Usuarios.
   * @param hasher - Hash de contraseñas.
   * @param sessions - Almacén de sesiones.
   * @param secrets - SHA-256 del token.
   * @param clock - Reloj, para el vencimiento.
   */
  constructor(
    private readonly resets: PasswordResetRepository,
    private readonly users: UserRepository,
    private readonly hasher: PasswordHasher,
    private readonly sessions: SessionPort,
    private readonly secrets: SecretsPort,
    private readonly clock: Clock,
  ) {}

  /**
   * @param input - Token y contraseña nueva.
   * @returns `ok` si cambió; `err('invalid_token')` si el token no existe, venció o ya se usó.
   */
  async execute(input: ResetPasswordInput): Promise<Result<void, 'invalid_token'>> {
    const consumed = await this.resets.consume(this.secrets.sha256(input.token), this.clock.now())
    if (consumed === null) return err('invalid_token')
    await this.users.updatePassword(consumed.userId, await this.hasher.hash(input.password))
    await this.sessions.destroyAllForUser(consumed.userId)
    return ok(undefined)
  }
}
