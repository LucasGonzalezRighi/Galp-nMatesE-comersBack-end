import type { SessionPort } from '../../../../shared/application/ports/session.port'

/** Cierre de sesión (cliente o admin). */
export class LogoutCommand {
  /** @param sessions - Almacén de sesiones. */
  constructor(private readonly sessions: SessionPort) {}

  /**
   * @param sessionId - Id de la sesión a cerrar (si ya no existe, no hace nada).
   */
  async execute(sessionId: string): Promise<void> {
    await this.sessions.destroy(sessionId)
  }
}
