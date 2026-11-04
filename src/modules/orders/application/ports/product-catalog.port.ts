import type { PricedCombo, PricedProduct } from '../../domain/pricing'

/**
 * Lo que `orders` necesita del catálogo para cotizar: productos por id con su stock libre y los
 * combos por id con sus piezas.
 */
export interface ProductCatalogPort {
  /**
   * Busca productos por id para cotizar un carrito, con el stock leído de la base (sin caché).
   *
   * @param ids - Ids de las líneas y de las piezas de los kits y de los combos (sin repetir).
   * @returns Los productos encontrados, publicados o no (la cotización decide). Los ids que no
   *   existen, o que no son ids válidos, no vienen.
   */
  findForCart(ids: readonly string[]): Promise<PricedProduct[]>

  /**
   * Busca combos por id para cotizar un carrito, leídos de la base (sin caché).
   *
   * @param ids - Ids de los combos del carrito (sin repetir).
   * @returns Los combos encontrados, publicados o no (la cotización decide), con los ids de sus
   *   piezas en el orden del combo. Los ids que no existen, o que no son ids válidos, no vienen.
   */
  findCombosForCart(ids: readonly string[]): Promise<PricedCombo[]>
}

/** Token de inyección del {@link ProductCatalogPort}. */
export const PRODUCT_CATALOG_PORT = Symbol('PRODUCT_CATALOG_PORT')
