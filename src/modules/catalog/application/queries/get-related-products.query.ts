import { selectRelated } from '../../domain/product.entity'
import type { PriceDisplayPort } from '../ports/price-display.port'
import type { ProductRepository } from '../ports/product.repository.port'
import { toProductSummary } from '../product-views'
import type { ProductSummary } from '../read-models'

/** Cantidad de relacionados que devuelve la ficha (contrato). */
export const RELATED_PRODUCTS_LIMIT = 4

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
   * Devuelve hasta 4 relacionados publicados: primero los de la misma línea y después los del
   * mismo grupo en otras líneas, por código. Nunca incluye al producto pedido.
   *
   * @param slug - Slug actual o anterior del producto.
   * @returns Los relacionados, o `null` si no hay un producto publicado con ese slug.
   * @throws {TypeError} En español, si el slug está vacío.
   */
  async execute(slug: string): Promise<ProductSummary[] | null> {
    if (slug.trim() === '') throw new TypeError('El slug del producto no puede estar vacío.')
    const product = await this.products.findBySlug(slug)
    if (product === null) return null
    const [candidates, prices] = await Promise.all([
      this.products.listPublishedByGroup(product.group),
      this.prices.get(),
    ])
    return selectRelated(product, candidates, RELATED_PRODUCTS_LIMIT).map((related) =>
      toProductSummary(related, prices),
    )
  }
}
