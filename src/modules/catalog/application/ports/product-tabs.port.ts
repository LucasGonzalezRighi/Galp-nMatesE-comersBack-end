import type { GroupTabsTexts } from '../../domain/product.entity'

/** Textos de las pestañas de la ficha por grupo, más el de envíos. */
export interface ProductTabsTexts {
  /** Pestañas de los mates. */
  mate: GroupTabsTexts
  /** Pestañas de las bombillas. */
  bombilla: GroupTabsTexts
  /** Pestañas de las yerbas. */
  yerba: GroupTabsTexts
  /** Texto de la pestaña Envíos, común a todos. */
  shipping: string
}

/** Lectura de las pestañas de la ficha (las implementa el módulo `content`). */
export interface ProductTabsPort {
  /**
   * Devuelve los textos de las pestañas.
   *
   * @throws {Error} En español, si el contenido `product-tabs` no está cargado.
   */
  get(): Promise<ProductTabsTexts>
}

/** Token de inyección del {@link ProductTabsPort}. */
export const PRODUCT_TABS_PORT = Symbol('PRODUCT_TABS_PORT')
