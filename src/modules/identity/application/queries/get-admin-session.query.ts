import type { SessionRecord } from '../../../../shared/application/ports/session.port'
import { StaleSessionError } from '../../domain/identity-errors'
import type { UserRepository } from '../ports/user.repository.port'

/** Sesión activa del dashboard como la devuelve la API (`AdminSession` del contrato). */
export interface AdminSessionView {
  /** Email del administrador. */
  email: string
  /** Cuándo vence la sesión (ISO 8601 UTC). */
  expiresAt: string
}

/** Sesión del dashboard (`GET /admin/auth/me`): el email del admin y cuándo vence. */
export class GetAdminSessionQuery {
  /** @param users - Usuarios. */
  constructor(private readonly users: UserRepository) {}

  /**
   * @param session - Sesión de admin (la que dejó el guard).
   * @returns El email del admin y el vencimiento de la sesión.
   * @throws {TypeError} En español, si la sesión no es de admin.
   * @throws {StaleSessionError} Si el usuario ya no existe, no es admin o está deshabilitado.
   */
  async execute(session: SessionRecord): Promise<AdminSessionView> {
    if (session.kind !== 'admin' || session.userId === null) {
      throw new TypeError('La sesión del dashboard necesita una sesión de admin')
    }
    const user = await this.users.findById(session.userId)
    if (user?.role !== 'admin' || user.status !== 'active') {
      throw new StaleSessionError()
    }
    return { email: user.email, expiresAt: session.expiresAt }
  }
}
