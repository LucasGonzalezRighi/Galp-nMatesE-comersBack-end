import type { SessionPort, SessionRecord } from '../../../../shared/application/ports/session.port'

/** Sesión cuyo CSRF se entrega. */
export interface IssuedCsrfToken {
  /** Sesión (la actual o una anónima nueva). */
  session: SessionRecord
  /** `true` si se abrió una sesión anónima nueva (hay que mandar su cookie). */
  created: boolean
}

/**
 * Token CSRF de la tienda (`GET /auth/csrf`): el de la sesión actual si es válida (anónima o de
 * cliente); si no, abre una sesión anónima nueva.
 */
export class IssueCsrfTokenCommand {
  /** @param sessions - Almacén de sesiones. */
  constructor(private readonly sessions: SessionPort) {}

  /**
   * @param currentSessionId - Id de la cookie de sesión de la tienda, o `null`.
   * @returns La sesión con su CSRF y si es nueva.
   */
  async execute(currentSessionId: string | null): Promise<IssuedCsrfToken> {
    if (currentSessionId !== null) {
      const current = await this.sessions.get(currentSessionId)
      if (current !== null && current.kind !== 'admin') return { session: current, created: false }
    }
    const session = await this.sessions.create({
      kind: 'anonymous',
      userId: null,
      customerId: null,
    })
    return { session, created: true }
  }
}
