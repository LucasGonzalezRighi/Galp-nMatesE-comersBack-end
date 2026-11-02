/** Lo que `reviews` necesita del catálogo: saber qué producto publicado tiene un slug. */
export interface ProductLookupPort {
  /**
   * Busca el producto publicado con ese slug, actual o anterior.
   *
   * @param slug - Slug pedido.
   * @returns El id del producto, o `null` si no hay uno publicado con ese slug.
   */
  findPublishedIdBySlug(slug: string): Promise<string | null>
}

/** Token de inyección del {@link ProductLookupPort}. */
export const PRODUCT_LOOKUP_PORT = Symbol('PRODUCT_LOOKUP_PORT')
