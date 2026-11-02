import type { PriceDisplayPort } from '../ports/price-display.port'
import type { ProductRepository } from '../ports/product.repository.port'
import type { ProductTabsPort } from '../ports/product-tabs.port'
import { toProductDetail } from '../product-views'
import type { ProductDetail } from '../read-models'

/** Ficha de un producto publicado (`GET /products/{slug}`). */
export class GetProductQuery {
  /**
   * @param products - Lecturas de productos.
   * @param prices - Ajustes de precios (precio sin IVA).
   * @param tabs - Pestañas de la ficha por grupo.
   */
  constructor(
    private readonly products: ProductRepository,
    private readonly prices: PriceDisplayPort,
    private readonly tabs: ProductTabsPort,
  ) {}

  /**
   * Devuelve la ficha de un producto publicado. Si el slug es uno anterior, devuelve el producto
   * con su slug actual (la tienda redirige).
   *
   * @param slug - Slug actual o anterior.
   * @returns La ficha, o `null` si no hay un producto publicado con ese slug.
   * @throws {TypeError} En español, si el slug está vacío.
   */
  async execute(slug: string): Promise<ProductDetail | null> {
    if (slug.trim() === '') throw new TypeError('El slug del producto no puede estar vacío.')
    const product = await this.products.findBySlug(slug)
    if (product === null) return null
    const [prices, tabs] = await Promise.all([this.prices.get(), this.tabs.get()])
    return toProductDetail(product, prices, tabs)
  }
}
