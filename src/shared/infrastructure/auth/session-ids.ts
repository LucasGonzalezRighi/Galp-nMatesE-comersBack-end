import type { SessionRecord } from '../../application/ports/session.port'

/**
 * Cliente de una sesión de cliente (la que dejó `CustomerSessionGuard`, `CustomerCsrfGuard` u
 * `OptionalCustomerSessionGuard`).
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
