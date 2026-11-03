import type { PricedProduct } from '../../domain/pricing'

/** Lo que `orders` necesita del catálogo para cotizar: productos por id con su stock libre. */
export interface ProductCatalogPort {
  /**
   * Busca productos por id para cotizar un carrito, con el stock leído de la base (sin caché).
   *
   * @param ids - Ids de las líneas y de las piezas de los kits (sin repetir).
   * @returns Los productos encontrados, publicados o no (la cotización decide). Los ids que no
   *   existen, o que no son ids válidos, no vienen.
   */
  findForCart(ids: readonly string[]): Promise<PricedProduct[]>
}

/** Token de inyección del {@link ProductCatalogPort}. */
export const PRODUCT_CATALOG_PORT = Symbol('PRODUCT_CATALOG_PORT')
