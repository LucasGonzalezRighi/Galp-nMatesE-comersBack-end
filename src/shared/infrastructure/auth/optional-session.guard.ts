import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  Inject,
  Injectable,
} from '@nestjs/common'

import {
  SESSION_PORT,
  type SessionPort,
  type SessionRecord,
} from '../../application/ports/session.port'
import { CUSTOMER_SESSION_COOKIE, readSessionCookie } from './cookies'
import type { SessionRequest } from './session.guards'

/**
 * Sesión de cliente **opcional** (rutas con `security: []` que igual asocian el pedido a la
 * cuenta, como `POST /orders`): siempre deja pasar. Si la cookie `__Host-galpon_session`
 * corresponde a una sesión de cliente vigente, la deja en el pedido para `@OptionalSession()`;
 * sin cookie, con una sesión anónima, de admin o vencida, sigue como invitado. No valida CSRF.
 *
 * Falla cerrado como el resto de las sesiones: con cookie y el almacén caído, el 503 del
 * `SessionPort` sale tal cual (no se degrada a invitado). Sin cookie no consulta el almacén.
 */
@Injectable()
export class OptionalCustomerSessionGuard implements CanActivate {
  /** @param sessions - Almacén de sesiones. */
  constructor(@Inject(SESSION_PORT) private readonly sessions: SessionPort) {}

  /**
   * Carga la sesión del cliente si la hay y deja pasar.
   *
   * @param context - Contexto de Nest (HTTP).
   * @returns Siempre `true`.
   * @throws {DomainError} 503 si hay cookie y el almacén de sesiones no responde.
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<SessionRequest>()
    const id = readSessionCookie(req, CUSTOMER_SESSION_COOKIE)
    if (id === null) return true
    const session = req.galponSession?.id === id ? req.galponSession : await this.sessions.get(id)
    if (session?.kind === 'customer') req.galponSession = session
    return true
  }
}

/**
 * Lee la sesión opcional del pedido.
 *
 * @param context - Contexto de Nest (HTTP).
 * @returns La sesión que dejó un guard, o `null` si no hay (invitado o ruta sin guard).
 */
export function optionalSessionFromContext(context: ExecutionContext): SessionRecord | null {
  return context.switchToHttp().getRequest<SessionRequest>().galponSession ?? null
}

/**
 * Parámetro con la sesión del cliente o `null` (`SessionRecord | null`), la que dejó
 * {@link OptionalCustomerSessionGuard}. A diferencia de `@CurrentSession()`, nunca lanza: sin
 * guard en la ruta devuelve `null`.
 *
 * @example
 * \@Post()
 * \@UseGuards(OptionalCustomerSessionGuard)
 * create(\@OptionalSession() session: SessionRecord | null) { … }
 */
export const OptionalSession = createParamDecorator((_data: unknown, context: ExecutionContext) =>
  optionalSessionFromContext(context),
)
