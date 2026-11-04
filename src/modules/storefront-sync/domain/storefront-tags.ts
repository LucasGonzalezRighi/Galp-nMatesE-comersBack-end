import {
  STOREFRONT_STALE_EVENT,
  STOREFRONT_TAG_PATTERN,
} from '../../../shared/domain/storefront-tags'

/**
 * Evento de combos del catálogo (`COMBO_CHANGED_EVENT`), como texto: este módulo no importa nada
 * de `catalog`. Sigue avisando `combos`, también para los eventos que queden sin publicar al
 * desplegar.
 */
const COMBO_CHANGED_EVENT = 'combo.changed'

/**
 * Etiquetas de un `storefront.stale`: las de `payload.tags`, solo las que son texto.
 *
 * @param payload - Datos del evento (`{ reason, tags }`).
 * @returns Las etiquetas, o vacío si el evento no trae la lista.
 */
function staleTags(payload: unknown): readonly string[] {
  if (typeof payload !== 'object' || payload === null || !('tags' in payload)) return []
  const { tags } = payload
  if (!Array.isArray(tags)) return []
  return tags.filter((tag): tag is string => typeof tag === 'string')
}

/** Qué etiquetas regenera cada tipo de evento. */
const TAGS_BY_EVENT = new Map<string, (payload: unknown) => readonly string[]>([
  [COMBO_CHANGED_EVENT, () => ['combos']],
  [STOREFRONT_STALE_EVENT, staleTags],
])

/** Tipos de evento del outbox que le avisan algo a la tienda. */
export const STOREFRONT_EVENT_TYPES: readonly string[] = [...TAGS_BY_EVENT.keys()]

/**
 * Etiquetas que la tienda tiene que regenerar por un evento del outbox.
 *
 * @param type - Tipo del evento, por ejemplo `storefront.stale` o `combo.changed`.
 * @param payload - Datos del evento (`storefront.stale` trae sus etiquetas en `tags`).
 * @returns Las etiquetas, sin repetidas y solo las que cumplen {@link STOREFRONT_TAG_PATTERN}
 *   (nunca algo que la tienda rechace con 422); vacío si el tipo no le importa a la tienda.
 */
export function storefrontTagsFor(type: string, payload: unknown): string[] {
  const tagsOf = TAGS_BY_EVENT.get(type)
  if (tagsOf === undefined) return []
  return [...new Set(tagsOf(payload))].filter((tag) => STOREFRONT_TAG_PATTERN.test(tag))
}
