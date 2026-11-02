import { createParamDecorator, type ExecutionContext } from '@nestjs/common'

import type { SessionRecord } from '../../application/ports/session.port'
import type { SessionRequest } from './session.guards'

/**
 * Lee la sesión que dejó el guard en el pedido.
 *
 * @param context - Contexto de Nest (HTTP).
 * @returns La sesión.
 * @throws {Error} En español, si la ruta no tiene un guard de sesión o de CSRF (error de
 *   programación: sale como 500).
 */
export function sessionFromContext(context: ExecutionContext): SessionRecord {
  const session = context.switchToHttp().getRequest<SessionRequest>().galponSession
  if (session === undefined) {
    throw new Error('@CurrentSession() necesita un guard de sesión o de CSRF en la ruta')
  }
  return session
}

/**
 * Parámetro con la sesión del pedido (`SessionRecord`), la que dejó `CustomerSessionGuard`,
 * `AdminSessionGuard`, `CustomerCsrfGuard` o `AdminCsrfGuard`.
 *
 * @example
 * \@Get()
 * \@UseGuards(CustomerSessionGuard)
 * me(\@CurrentSession() session: SessionRecord) { … }
 */
export const CurrentSession = createParamDecorator((_data: unknown, context: ExecutionContext) =>
  sessionFromContext(context),
)
