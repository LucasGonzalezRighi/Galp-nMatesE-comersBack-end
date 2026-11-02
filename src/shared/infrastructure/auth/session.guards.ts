import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import { timingSafeEqual } from 'node:crypto'

import {
  SESSION_PORT,
  type SessionKind,
  type SessionPort,
  type SessionRecord,
} from '../../application/ports/session.port'
import type { ProblemBody } from '../http/problem.filter'
import {
  ADMIN_SESSION_COOKIE,
  type CookieRequest,
  CSRF_HEADER,
  CUSTOMER_SESSION_COOKIE,
  readSessionCookie,
} from './cookies'

/** Pedido después de pasar un guard de sesión: la sesión queda en `galponSession`. */
export interface SessionRequest extends CookieRequest {
  /** Headers del pedido (se usan `cookie` y `x-csrf-token`). */
  headers: CookieRequest['headers'] & { [CSRF_HEADER]?: string | string[] | undefined }
  /** Sesión que dejó el guard; la lee `@CurrentSession()`. */
  galponSession?: SessionRecord
}

/** Cuerpo del 403 cuando falta el token CSRF o no coincide (también para el cliente). */
export const CSRF_INVALID_PROBLEM = {
  type: 'csrf_invalid',
  title: 'Token CSRF inválido',
  detail: 'El token CSRF falta o no es válido.',
} as const satisfies ProblemBody

/**
 * Busca la sesión de la cookie `cookieName`. Si un guard anterior ya la cargó para el mismo id
 * (por ejemplo, sesión + CSRF en el logout), la reutiliza sin volver a Redis.
 *
 * @throws {DomainError} 503 si el almacén no responde (falla cerrado).
 */
async function loadSession(
  sessions: SessionPort,
  req: SessionRequest,
  cookieName: string,
): Promise<SessionRecord | null> {
  const id = readSessionCookie(req, cookieName)
  if (id === null) return null
  if (req.galponSession?.id === id) return req.galponSession
  return sessions.get(id)
}

/** Compara dos textos en tiempo constante (si tienen el mismo largo en bytes). */
function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, 'utf8')
  const b = Buffer.from(right, 'utf8')
  return a.length === b.length && timingSafeEqual(a, b)
}

/** Base de los guards que exigen una sesión de un tipo; si no está, 401 con los defaults. */
abstract class SessionGuard implements CanActivate {
  protected abstract readonly cookieName: string
  protected abstract readonly kind: SessionKind

  constructor(@Inject(SESSION_PORT) private readonly sessions: SessionPort) {}

  /**
   * Deja pasar si la cookie corresponde a una sesión vigente del tipo pedido.
   *
   * @throws {UnauthorizedException} 401 `unauthorized` si no hay sesión válida.
   * @throws {DomainError} 503 si el almacén de sesiones no responde.
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<SessionRequest>()
    const session = await loadSession(this.sessions, req, this.cookieName)
    if (session?.kind !== this.kind) throw new UnauthorizedException()
    req.galponSession = session
    return true
  }
}

/** Base de los guards CSRF: header `X-CSRF-Token` igual al `csrfToken` de la sesión. */
abstract class CsrfGuard implements CanActivate {
  protected abstract readonly cookieName: string
  protected abstract readonly kinds: readonly SessionKind[]

  constructor(@Inject(SESSION_PORT) private readonly sessions: SessionPort) {}

  /**
   * Deja pasar si hay cookie, sesión vigente de un tipo aceptado y el header coincide con su
   * token (comparación en tiempo constante).
   *
   * @throws {ForbiddenException} 403 `csrf_invalid` si falta algo o no coincide.
   * @throws {DomainError} 503 si el almacén de sesiones no responde.
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<SessionRequest>()
    const header = req.headers[CSRF_HEADER]
    if (typeof header !== 'string' || header === '') throw csrfInvalid()
    const session = await loadSession(this.sessions, req, this.cookieName)
    if (session === null || !this.kinds.includes(session.kind)) throw csrfInvalid()
    if (!safeEqual(header, session.csrfToken)) throw csrfInvalid()
    req.galponSession = session
    return true
  }
}

function csrfInvalid(): ForbiddenException {
  return new ForbiddenException({ ...CSRF_INVALID_PROBLEM })
}

/** Exige la sesión de un cliente (`__Host-galpon_session` con `kind: 'customer'`); si no, 401. */
@Injectable()
export class CustomerSessionGuard extends SessionGuard {
  protected readonly cookieName = CUSTOMER_SESSION_COOKIE
  protected readonly kind = 'customer'
}

/** Exige la sesión del admin (`__Host-galpon_admin` con `kind: 'admin'`); si no, 401. */
@Injectable()
export class AdminSessionGuard extends SessionGuard {
  protected readonly cookieName = ADMIN_SESSION_COOKIE
  protected readonly kind = 'admin'
}

/**
 * CSRF de la tienda: cookie `__Host-galpon_session` con sesión anónima o de cliente y
 * `X-CSRF-Token` igual a su token; si no, 403 `csrf_invalid`.
 */
@Injectable()
export class CustomerCsrfGuard extends CsrfGuard {
  protected readonly cookieName = CUSTOMER_SESSION_COOKIE
  protected readonly kinds = ['anonymous', 'customer'] as const
}

/**
 * CSRF del admin: cookie `__Host-galpon_admin` con sesión de admin y `X-CSRF-Token` igual a su
 * token; si no, 403 `csrf_invalid`.
 */
@Injectable()
export class AdminCsrfGuard extends CsrfGuard {
  protected readonly cookieName = ADMIN_SESSION_COOKIE
  protected readonly kinds = ['admin'] as const
}
