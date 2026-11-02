import type { Server } from 'node:http'
import request from 'supertest'
import { expect } from 'vitest'

/** Prefijo de la API (lo pone `setupApp`). */
const API_PREFIX = '/api/v1'

/** Métodos HTTP que usan los E2E. */
export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete'

/**
 * Lo que un navegador guarda entre pedidos: la cookie de sesión (`nombre=valor`) y el último token
 * CSRF que le dio el back.
 */
export interface Jar {
  /** Cookie de sesión como `nombre=valor`, o `null` si no hay. */
  cookie: string | null
  /** Último token CSRF, o `null` si todavía no lo pidió. */
  csrf: string | null
}

/** Opciones de un pedido de {@link call}. */
export interface CallOptions {
  /** Cuerpo JSON. */
  body?: unknown
  /** `false` para no mandar `X-CSRF-Token` aunque el jar tenga uno. */
  csrf?: boolean
  /** Headers de más (por ejemplo `Idempotency-Key` o `X-Order-Token`). */
  headers?: Record<string, string>
}

/**
 * Navegador nuevo, sin cookie ni CSRF.
 *
 * @returns Un {@link Jar} vacío.
 */
export function newJar(): Jar {
  return { cookie: null, csrf: null }
}

/**
 * `Set-Cookie` de la respuesta como lista.
 *
 * @param response - Respuesta de supertest.
 * @returns Los `Set-Cookie`, o `[]` si no hay.
 */
export function setCookies(response: request.Response): string[] {
  const header: unknown = response.headers['set-cookie']
  return Array.isArray(header) ? (header as string[]) : []
}

/**
 * Primer error por campo de una respuesta 422 (`errors[0]` del `Problem`).
 *
 * @param response - Respuesta de supertest.
 * @returns El primer `FieldError`, o `undefined` si no hay.
 */
export function firstError(response: request.Response): unknown {
  const { errors } = response.body as { errors?: unknown[] }
  return errors?.[0]
}

/**
 * Hace un pedido como el navegador del jar: le pone el prefijo `/api/v1`, manda su cookie, su
 * CSRF (salvo `csrf: false`) y los headers de más, y guarda la cookie que llegue en `Set-Cookie`
 * (con `Max-Age=0`, la borra).
 *
 * @param server - Servidor HTTP de la app (`app.getHttpServer()`).
 * @param jar - Navegador que hace el pedido (se actualiza su cookie).
 * @param method - Método HTTP.
 * @param path - Ruta sin el prefijo, por ejemplo `/orders`.
 * @param options - Cuerpo, CSRF y headers.
 * @returns La respuesta de supertest.
 */
export async function call(
  server: Server,
  jar: Jar,
  method: HttpMethod,
  path: string,
  options: CallOptions = {},
): Promise<request.Response> {
  let pending = request(server)[method](`${API_PREFIX}${path}`)
  if (jar.cookie !== null) pending = pending.set('Cookie', jar.cookie)
  if (options.csrf !== false && jar.csrf !== null) pending = pending.set('X-CSRF-Token', jar.csrf)
  for (const [name, value] of Object.entries(options.headers ?? {})) {
    pending = pending.set(name, value)
  }
  const response =
    options.body === undefined ? await pending : await pending.send(options.body as object)
  for (const header of setCookies(response)) {
    const [pair = ''] = header.split(';')
    jar.cookie = header.endsWith('Max-Age=0') ? null : pair
  }
  return response
}

/**
 * Pide el CSRF de la tienda (como hace el front al cargar y después de cada login/logout) y lo
 * guarda en el jar.
 *
 * @param server - Servidor HTTP de la app.
 * @param jar - Navegador que lo pide.
 * @returns La respuesta (ya verificada con 200).
 */
export async function refreshCsrf(server: Server, jar: Jar): Promise<request.Response> {
  const response = await call(server, jar, 'get', '/auth/csrf')
  expect(response.status).toBe(200)
  jar.csrf = (response.body as { csrfToken: string }).csrfToken
  return response
}
