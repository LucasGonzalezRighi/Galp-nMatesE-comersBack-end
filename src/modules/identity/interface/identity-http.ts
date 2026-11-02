import type { SessionRecord } from '../../../shared/application/ports/session.port'

/**
 * Límite por IP de las escrituras de autenticación (registro, inicio de sesión, recuperación y
 * login del admin): 20 por minuto. El resto de las rutas queda con los 120 por minuto globales.
 */
export const AUTH_WRITE_THROTTLE = { default: { limit: 20, ttl: 60_000 } } as const

/** Lo que los controladores usan de la respuesta de Express: el header `Set-Cookie`. */
export interface CookieResponse {
  /**
   * Pone un header en la respuesta.
   *
   * @param name - Nombre del header.
   * @param value - Valor.
   */
  setHeader(name: string, value: string): unknown
}

/**
 * Cliente de una sesión de cliente (la que dejó `CustomerSessionGuard` o `CustomerCsrfGuard`).
 *
 * @param session - Sesión del pedido.
 * @returns El id del cliente.
 * @throws {Error} En español, si la sesión no tiene cliente (error de programación: sale como 500).
 */
export function customerIdOf(session: SessionRecord): string {
  if (session.kind !== 'customer' || session.customerId === null) {
    throw new Error('La ruta necesita una sesión de cliente con su cliente asociado')
  }
  return session.customerId
}

/**
 * Usuario de una sesión de admin (la que dejó `AdminSessionGuard` o `AdminCsrfGuard`).
 *
 * @param session - Sesión del pedido.
 * @returns El id del usuario.
 * @throws {Error} En español, si la sesión no es de admin (error de programación: sale como 500).
 */
export function adminUserIdOf(session: SessionRecord): string {
  if (session.kind !== 'admin' || session.userId === null) {
    throw new Error('La ruta necesita una sesión de admin con su usuario')
  }
  return session.userId
}
