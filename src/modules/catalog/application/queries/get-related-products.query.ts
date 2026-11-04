import { PRODUCT_GROUPS } from '../../domain/category.entity'
import { selectRelated } from '../../domain/product.entity'
import type { PriceDisplayPort } from '../ports/price-display.port'
import type { ProductRepository } from '../ports/product.repository.port'
import { toProductSummary } from '../product-views'
import type { ProductSummary } from '../read-models'

/** Máximo de relacionados que devuelve la ficha (`maxItems` del contrato). */
export const RELATED_PRODUCTS_LIMIT = 30

/** Productos relacionados con uno (`GET /products/{slug}/related`). */
export class GetRelatedProductsQuery {
  /**
   * @param products - Lecturas de productos.
   * @param prices - Ajustes de precios (precio sin IVA).
   */
  constructor(
    private readonly products: ProductRepository,
    private readonly prices: PriceDisplayPort,
  ) {}

  /**
   * Devuelve hasta {@link RELATED_PRODUCTS_LIMIT} relacionados publicados, nunca el producto
   * pedido: primero los de la misma línea, después los del mismo grupo en otras líneas y después
   * el resto por grupo (mate, bombilla, yerba), cada tramo por código. Lee los publicados de cada
   * grupo (con caché) en paralelo.
   *
   * @param slug - Slug actual o anterior del producto.
   * @returns Los relacionados, o `null` si no hay un producto publicado con ese slug.
   * @throws {TypeError} En español, si el slug está vacío.
   */
  async execute(slug: string): Promise<ProductSummary[] | null> {
    if (slug.trim() === '') throw new TypeError('El slug del producto no puede estar vacío.')
    const product = await this.products.findBySlug(slug)
    if (product === null) return null
    const [groups, prices] = await Promise.all([
      Promise.all(PRODUCT_GROUPS.map((group) => this.products.listPublishedByGroup(group))),
      this.prices.get(),
    ])
    return selectRelated(product, groups.flat(), RELATED_PRODUCTS_LIMIT).map((related) =>
      toProductSummary(related, prices),
    )
  }
}
