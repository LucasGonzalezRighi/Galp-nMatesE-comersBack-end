/** Claves de los contenidos editables (`content_blocks.key`). */
export const CONTENT_KEYS = [
  'home',
  'about',
  'faq',
  'footer',
  'product-tabs',
  'legal-terms',
  'legal-privacy',
  'legal-cookies',
  'legal-returns',
] as const

/** Clave de un contenido editable. */
export type ContentKey = (typeof CONTENT_KEYS)[number]

/**
 * Documentos legales del contrato (`/content/legal/{document}`), en el orden en que se listan
 * (copia de `LEGAL_DOCUMENTS` de `@galpon/domain`).
 */
export const LEGAL_DOCUMENTS = ['terms', 'privacy', 'cookies', 'returns'] as const

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

/** Clave de contenido de un documento legal (`legal-terms`, `legal-cookies`…). */
export type LegalContentKey = `legal-${LegalDocument}`

/**
 * Indica si un texto es un documento legal del contrato.
 *
 * @param value - Texto a revisar (por ejemplo, `{document}` de la ruta).
 * @returns `true` si es `terms`, `privacy`, `cookies` o `returns`.
 */
export function isLegalDocument(value: string): value is LegalDocument {
  return (LEGAL_DOCUMENTS as readonly string[]).includes(value)
}

/**
 * Da la clave de contenido de un documento legal.
 *
 * @param document - `terms`, `privacy`, `cookies` o `returns`.
 * @returns `legal-terms`, `legal-privacy`, `legal-cookies` o `legal-returns`.
 * @throws {RangeError} En español, si no es un documento legal del contrato.
 */
export function legalContentKey(document: LegalDocument): LegalContentKey {
  if (!isLegalDocument(document)) {
    throw new RangeError(
      `El documento legal tiene que ser ${LEGAL_DOCUMENTS.join(', ')}; se recibió "${String(document)}".`,
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
