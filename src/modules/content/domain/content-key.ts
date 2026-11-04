/** Claves de los contenidos editables (`content_blocks.key`). */
export const CONTENT_KEYS = [
  'home',
  'about',
  'faq',
  'footer',
  'product-tabs',
  'legal-terms',
  'legal-privacy',
] as const

/** Clave de un contenido editable. */
export type ContentKey = (typeof CONTENT_KEYS)[number]

/** Documentos legales del contrato (`/content/legal/{document}`). */
export const LEGAL_DOCUMENTS = ['terms', 'privacy'] as const

/** Documento legal del contrato. */
export type LegalDocument = (typeof LEGAL_DOCUMENTS)[number]

/**
 * Indica si un texto es una clave de contenido.
 *
 * @param value - Texto a revisar.
 * @returns `true` si es una {@link ContentKey}.
 */
export function isContentKey(value: string): value is ContentKey {
  return (CONTENT_KEYS as readonly string[]).includes(value)
}

/**
 * Da la clave de contenido de un documento legal.
 *
 * @param document - `terms` o `privacy`.
 * @returns `legal-terms` o `legal-privacy`.
 * @throws {RangeError} En español, si no es un documento legal del contrato.
 */
export function legalContentKey(document: LegalDocument): ContentKey {
  if (!(LEGAL_DOCUMENTS as readonly string[]).includes(document)) {
    throw new RangeError(
      `El documento legal tiene que ser terms o privacy; se recibió "${document}".`,
    )
  }
  return `legal-${document}`
}

/** `reason` del aviso a la tienda de cada guardado de un contenido (Ruling B-73). */
export const CONTENT_UPDATED_REASON = 'content.updated'

/**
 * Etiquetas de la tienda que regenera el guardado de un contenido (Ruling B-73): la de su clave
 * (`content:home`, `content:legal-terms`…); las pestañas de la ficha suman `products`, porque la
 * ficha trae los textos ya combinados.
 *
 * @param key - Clave del contenido guardado.
 * @returns Las etiquetas, en el orden en que se avisan.
 * @throws {RangeError} En español, si no es una clave de contenido.
 */
export function contentStorefrontTags(key: ContentKey): string[] {
  if (!isContentKey(key)) {
    throw new RangeError(`"${String(key)}" no es una clave de contenido.`)
  }
  const tag = `content:${key}`
  return key === 'product-tabs' ? [tag, 'products'] : [tag]
}
