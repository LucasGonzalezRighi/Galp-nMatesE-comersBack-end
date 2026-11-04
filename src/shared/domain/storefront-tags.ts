import type { NewDomainEvent } from './domain-event'

/**
 * Etiquetas de caché que acepta `POST /api/revalidate` de la tienda: igual a
 * `REVALIDATE_TAG_PATTERN` de `apps/store/src/lib/revalidate.ts` del front. Si la tienda cambia
 * su patrón, este también.
 */
export const STOREFRONT_TAG_PATTERN =
  /^(products|categories|settings|combos|product:[a-z0-9-]+|reviews:[a-z0-9-]+|content:[a-z-]+)$/

/** Máximo de etiquetas por pedido a la tienda (`MAX_TAGS` de su ruta). */
export const STOREFRONT_MAX_TAGS = 50

/** Evento genérico del outbox que le avisa a la tienda qué etiquetas regenerar. */
export const STOREFRONT_STALE_EVENT = 'storefront.stale'

/** Tipo de agregado de {@link STOREFRONT_STALE_EVENT}. */
export const STOREFRONT_AGGREGATE = 'storefront'

/**
 * Evento `storefront.stale` para el outbox: va en la misma transacción de cada escritura que
 * cambia algo que la tienda cachea (dashboard y stock de los pedidos).
 *
 * @param reason - Qué escritura fue, por ejemplo `content.updated` o `order.created` (también es
 *   el `aggregateId`).
 * @param tags - Etiquetas que la tienda tiene que regenerar, cada una con
 *   {@link STOREFRONT_TAG_PATTERN}.
 * @returns El evento con `{ reason, tags }`: las etiquetas sin repetidas y en el orden recibido.
 * @throws {TypeError} En español, si `reason` está vacío.
 * @throws {RangeError} En español, si quedan 0 o más de {@link STOREFRONT_MAX_TAGS} etiquetas, o
 *   si alguna no cumple el patrón (una etiqueta mal escrita es un bug: no se filtra en silencio).
 */
export function storefrontStaleEvent(reason: string, tags: readonly string[]): NewDomainEvent {
  if (reason.trim() === '') {
    throw new TypeError('El aviso a la tienda necesita un motivo (reason)')
  }
  const unique = [...new Set(tags)]
  if (unique.length === 0 || unique.length > STOREFRONT_MAX_TAGS) {
    throw new RangeError(
      `El aviso a la tienda lleva de 1 a ${String(STOREFRONT_MAX_TAGS)} etiquetas (llegaron ${String(unique.length)})`,
    )
  }
  const invalid = unique.find((tag) => !STOREFRONT_TAG_PATTERN.test(tag))
  if (invalid !== undefined) {
    throw new RangeError(`La tienda no acepta la etiqueta "${invalid}"`)
  }
  return {
    type: STOREFRONT_STALE_EVENT,
    aggregateType: STOREFRONT_AGGREGATE,
    aggregateId: reason,
    payload: { reason, tags: unique },
  }
}
