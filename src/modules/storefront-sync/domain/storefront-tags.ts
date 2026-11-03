import { COMBO_CHANGED_EVENT } from '../../catalog/domain/combo-events'

/**
 * Etiquetas de caché que acepta `POST /api/revalidate` de la tienda: igual a
 * `REVALIDATE_TAG_PATTERN` de `apps/store/src/lib/revalidate.ts` del front, con `combos`. Si la
 * tienda cambia su patrón, este también.
 */
export const STOREFRONT_TAG_PATTERN =
  /^(products|categories|settings|combos|product:[a-z0-9-]+|reviews:[a-z0-9-]+|content:[a-z-]+)$/

/** Máximo de etiquetas por pedido a la tienda (`MAX_TAGS` de su ruta). */
export const STOREFRONT_MAX_TAGS = 50

/** Qué etiquetas regenera cada tipo de evento (B6 suma productos, categorías, contenidos…). */
const TAGS_BY_EVENT = new Map<string, (payload: unknown) => readonly string[]>([
  [COMBO_CHANGED_EVENT, () => ['combos']],
])

/** Tipos de evento del outbox que le avisan algo a la tienda. */
export const STOREFRONT_EVENT_TYPES: readonly string[] = [...TAGS_BY_EVENT.keys()]

/**
 * Etiquetas que la tienda tiene que regenerar por un evento del outbox.
 *
 * @param type - Tipo del evento, por ejemplo `combo.changed`.
 * @param payload - Datos del evento (B6 los usa para `product:{slug}`).
 * @returns Las etiquetas, sin repetidas y solo las que cumplen {@link STOREFRONT_TAG_PATTERN}
 *   (nunca algo que la tienda rechace con 422); vacío si el tipo no le importa a la tienda.
 */
export function storefrontTagsFor(type: string, payload: unknown): string[] {
  const tagsOf = TAGS_BY_EVENT.get(type)
  if (tagsOf === undefined) return []
  return [...new Set(tagsOf(payload))].filter((tag) => STOREFRONT_TAG_PATTERN.test(tag))
}
