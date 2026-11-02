// `customerIdOf` y `adminUserIdOf` se mudaron a `src/shared/infrastructure/auth/session-ids.ts`
// (también los usa `orders`); se re-exportan para no tocar los controladores de identidad.
export { adminUserIdOf, customerIdOf } from '../../../shared/infrastructure/auth/session-ids'

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

/** Token CSRF como lo devuelve la API (`CsrfToken` del contrato). */
export interface CsrfTokenView {
  /** Token que va en `X-CSRF-Token`. */
  csrfToken: string
}
