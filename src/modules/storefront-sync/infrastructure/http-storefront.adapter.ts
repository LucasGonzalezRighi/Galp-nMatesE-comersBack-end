import type { StorefrontPort, StorefrontRevalidation } from '../application/ports/storefront.port'
import { STOREFRONT_MAX_TAGS, STOREFRONT_TAG_PATTERN } from '../../../shared/domain/storefront-tags'

/** Tiempo máximo de cada pedido a la tienda. */
export const STOREFRONT_TIMEOUT_MS = 5_000

/** Largo máximo del motivo de un rechazo (el cuerpo lo arma otro sistema). */
const MAX_REASON_LENGTH = 300

/** Estados 4xx que son pasajeros: se reintentan como un 5xx. */
const TRANSIENT_CLIENT_STATUSES = new Set([408, 429])

/** Motivo del rechazo de una redirección: no se sigue (el secreto iría a otro destino). */
const STOREFRONT_REDIRECT_REASON = 'La tienda respondió con una redirección (revisá STORE_ORIGIN).'

/** Configuración de {@link HttpStorefrontAdapter}. */
export interface HttpStorefrontAdapterOptions {
  /** `STORE_ORIGIN`: el pedido va a `/api/revalidate` de ese origen. */
  storeOrigin: string
  /** `STORE_REVALIDATE_SECRET` (cabecera `x-revalidate-secret`); nunca se loguea. */
  secret: string | undefined
  /** `fetch` a usar (por defecto, el global de Node). */
  fetch?: typeof fetch
}

/** Motivo de un rechazo: el `error` del cuerpo JSON de la tienda, o uno genérico. */
async function reasonOf(response: Response): Promise<string> {
  const fallback = `La tienda respondió ${String(response.status)}.`
  try {
    const body: unknown = await response.json()
    if (typeof body === 'object' && body !== null && 'error' in body) {
      const { error } = body
      if (typeof error === 'string' && error.trim() !== '') {
        return error.slice(0, MAX_REASON_LENGTH)
      }
    }
  } catch {
    // Sin cuerpo JSON: alcanza con el estado.
  }
  return fallback
}

/**
 * {@link StorefrontPort} por HTTP: `POST ${STORE_ORIGIN}/api/revalidate` con la cabecera
 * `x-revalidate-secret` y `{ "tags": [...] }`, con timeout de {@link STOREFRONT_TIMEOUT_MS}.
 * Un 2xx es `revalidated`; un 4xx (salvo 408 y 429) es `rejected` con el `error` del cuerpo; un
 * 3xx no se sigue (`redirect: 'manual'`: el secreto no viaja a otro destino) y es `rejected`,
 * porque reintentar no lo arregla; un 5xx, 408, 429, un error de red o el timeout lanzan (se
 * reintenta). No loguea nada y sus errores nunca llevan el secreto.
 */
export class HttpStorefrontAdapter implements StorefrontPort {
  private readonly url: URL
  private readonly secret: string | undefined
  private readonly fetch: typeof fetch

  /**
   * @param options - Origen de la tienda, secreto y `fetch`.
   * @throws {TypeError} En español, si `storeOrigin` no es una URL.
   */
  constructor(options: HttpStorefrontAdapterOptions) {
    if (!URL.canParse(options.storeOrigin)) {
      throw new TypeError('El origen de la tienda (STORE_ORIGIN) no es una URL')
    }
    this.url = new URL('/api/revalidate', options.storeOrigin)
    this.secret = options.secret
    this.fetch = options.fetch ?? ((input, init) => fetch(input, init))
  }

  /**
   * Le pide a la tienda que regenere las etiquetas.
   *
   * @param tags - De 1 a {@link STOREFRONT_MAX_TAGS} etiquetas que cumplan
   *   {@link STOREFRONT_TAG_PATTERN}.
   * @returns `revalidated` o `rejected`.
   * @throws {RangeError} En español, si las etiquetas no son válidas (no llama a la tienda).
   * @throws {Error} En español, si falta el secreto o si la falla es pasajera.
   */
  async revalidate(tags: readonly string[]): Promise<StorefrontRevalidation> {
    if (tags.length === 0 || tags.length > STOREFRONT_MAX_TAGS) {
      throw new RangeError(
        `Se avisan de 1 a ${String(STOREFRONT_MAX_TAGS)} etiquetas (llegaron ${String(tags.length)})`,
      )
    }
    const invalid = tags.find((tag) => !STOREFRONT_TAG_PATTERN.test(tag))
    if (invalid !== undefined) {
      throw new RangeError(`La etiqueta ${JSON.stringify(invalid)} no es válida para la tienda`)
    }
    if (this.secret === undefined) {
      throw new Error('Sin STORE_REVALIDATE_SECRET no se le puede avisar a la tienda')
    }

    let response: Response
    try {
      response = await this.fetch(this.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-revalidate-secret': this.secret },
        body: JSON.stringify({ tags }),
        redirect: 'manual',
        signal: AbortSignal.timeout(STOREFRONT_TIMEOUT_MS),
      })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'TimeoutError') {
        throw new Error(
          `La tienda no contestó en ${String(STOREFRONT_TIMEOUT_MS / 1_000)} s (${this.url.origin})`,
          { cause: error },
        )
      }
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`No se pudo llegar a la tienda (${this.url.origin}): ${message}`, {
        cause: error,
      })
    }

    const { status } = response
    if (status >= 400 && status < 500 && !TRANSIENT_CLIENT_STATUSES.has(status)) {
      return { kind: 'rejected', status, reason: await reasonOf(response) }
    }
    // El cuerpo no hace falta: se descarta para liberar la conexión.
    await response.body?.cancel().catch(() => undefined)
    if (response.ok) return { kind: 'revalidated', tags: [...tags] }
    // Node devuelve el 3xx tal cual; un `fetch` de navegador, una respuesta `opaqueredirect`.
    if ((status >= 300 && status < 400) || response.type === 'opaqueredirect') {
      return { kind: 'rejected', status, reason: STOREFRONT_REDIRECT_REASON }
    }
    throw new Error(
      `La tienda respondió ${String(status)} al pedido de regenerar ${tags.join(', ')}`,
    )
  }
}
