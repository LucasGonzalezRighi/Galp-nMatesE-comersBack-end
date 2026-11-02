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
