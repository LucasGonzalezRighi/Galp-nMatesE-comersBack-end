/** Cookie de la sesión del cliente (la tienda en vivo busca este nombre exacto). */
export const CUSTOMER_SESSION_COOKIE = '__Host-galpon_session'

/** Cookie de la sesión del administrador. */
export const ADMIN_SESSION_COOKIE = '__Host-galpon_admin'

/** Header del token anti-CSRF (`X-CSRF-Token`), en minúsculas como lo deja Node. */
export const CSRF_HEADER = 'x-csrf-token'

/** Atributos fijos de las cookies de sesión: `__Host-` exige `Secure`, `Path=/` y sin `Domain`. */
const COOKIE_ATTRIBUTES = 'Path=/; HttpOnly; Secure; SameSite=Lax'

/** Caracteres permitidos en el valor (los ids son hex; nada de `;`, `,`, espacios ni comillas). */
const COOKIE_VALUE_PATTERN = /^[A-Za-z0-9._~-]*$/

/** Lo que se lee del pedido: `req.cookies` (de `cookie-parser`) y, si no está, el header. */
export interface CookieRequest {
  /** Headers del pedido; se usa `cookie` cuando no hay `req.cookies`. */
  headers: { cookie?: string | undefined }
  /** Cookies ya parseadas por `cookie-parser`, si el middleware corrió. */
  cookies?: unknown
}

/**
 * Arma el `Set-Cookie` de una sesión: `<name>=<id>; Path=/; HttpOnly; Secure; SameSite=Lax;
 * Max-Age=<segundos>`.
 *
 * @param name - Nombre de la cookie ({@link CUSTOMER_SESSION_COOKIE} o {@link ADMIN_SESSION_COOKIE}).
 * @param id - Id de la sesión.
 * @param maxAgeSeconds - Vida de la cookie en segundos: entero positivo (la duración de la sesión).
 * @returns El valor del header `Set-Cookie`.
 * @throws {TypeError} En español, si el nombre o el valor no son válidos para una cookie.
 * @throws {RangeError} En español, si `maxAgeSeconds` no es un entero positivo.
 */
export function sessionCookie(name: string, id: string, maxAgeSeconds: number): string {
  if (!Number.isInteger(maxAgeSeconds) || maxAgeSeconds < 1) {
    throw new RangeError(
      `El Max-Age de la cookie tiene que ser un entero positivo (llegó ${String(maxAgeSeconds)})`,
    )
  }
  return buildCookie(name, id, maxAgeSeconds)
}

/**
 * Arma el `Set-Cookie` que borra una sesión: mismo nombre y atributos, valor vacío y `Max-Age=0`.
 *
 * @param name - Nombre de la cookie.
 * @returns El valor del header `Set-Cookie`.
 * @throws {TypeError} En español, si el nombre no es válido para una cookie.
 */
export function clearedSessionCookie(name: string): string {
  return buildCookie(name, '', 0)
}

/**
 * Lee el id de sesión de una cookie: de `req.cookies` si `cookie-parser` corrió y, si no, del
 * header `Cookie` (así funciona también en las apps de prueba sin el middleware).
 *
 * @param req - El pedido (el `Request` de Express lo cumple).
 * @param name - Nombre de la cookie.
 * @returns El valor, o `null` si no está o está vacío.
 */
export function readSessionCookie(req: CookieRequest, name: string): string | null {
  const parsed = req.cookies
  const value =
    typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)[name]
      : parseCookieHeader(req.headers.cookie, name)
  return typeof value === 'string' && value !== '' ? value : null
}

function buildCookie(name: string, value: string, maxAgeSeconds: number): string {
  if (!/^[A-Za-z0-9_-]+$/.test(name)) {
    throw new TypeError(`Nombre de cookie inválido: "${name}"`)
  }
  if (!COOKIE_VALUE_PATTERN.test(value)) {
    throw new TypeError('El valor de la cookie tiene caracteres no permitidos')
  }
  return `${name}=${value}; ${COOKIE_ATTRIBUTES}; Max-Age=${String(maxAgeSeconds)}`
}

/** Busca una cookie en el header `Cookie` (`a=1; b=2`); la primera con ese nombre gana. */
function parseCookieHeader(header: string | undefined, name: string): string | undefined {
  if (header === undefined) return undefined
  for (const pair of header.split(';')) {
    const separator = pair.indexOf('=')
    if (separator === -1 || pair.slice(0, separator).trim() !== name) continue
    const raw = pair.slice(separator + 1).trim()
    try {
      return decodeURIComponent(raw)
    } catch {
      return raw
    }
  }
  return undefined
}
