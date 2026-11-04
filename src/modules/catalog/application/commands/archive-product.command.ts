import { canonicalId } from '../../../../shared/domain/id'
import { productStorefrontEvent } from '../../domain/catalog-admin-events'
import { ProductNotFoundError } from '../../domain/catalog-admin-errors'
import { toAdminProduct } from '../admin-catalog-views'
import type { AdminProductRepository } from '../ports/admin-product.repository.port'
import type { PriceDisplayPort } from '../ports/price-display.port'
import type { ProductTabsPort } from '../ports/product-tabs.port'
import type { AdminProduct } from '../read-models'

/** Archivo de un producto desde el dashboard (`POST /admin/products/{id}/archive`). */
export class ArchiveProductCommand {
  /**
   * @param products - Productos del dashboard.
   * @param prices - Ajustes de precios (precio sin IVA de la respuesta).
   * @param tabs - Pestañas de cada grupo (las de la respuesta).
   */
  constructor(
    private readonly products: Pick<AdminProductRepository, 'findById' | 'archive'>,
    private readonly prices: PriceDisplayPort,
    private readonly tabs: ProductTabsPort,
  ) {}

  /**
   * Archiva el producto: sale de la tienda (y los combos con él dejan de venderse) pero se
   * conserva con sus pedidos. Archivar uno archivado no cambia nada y avisa igual, como el mock
   * (`product.archived`). Para volver a publicarlo se modifica con `status: published`.
   *
   * @param id - Id del producto (uno que no es UUID no existe; uno en mayúsculas es el mismo).
   * @returns El producto archivado, con la forma `AdminProduct`.
   * @throws {ProductNotFoundError} 404 si no existe.
   */
  async execute(id: string): Promise<AdminProduct> {
    const productId = canonicalId(id)
    const current = await this.products.findById(productId)
    if (current === null) throw new ProductNotFoundError()
    const record = await this.products.archive(
      productId,
      productStorefrontEvent('product.archived', current.product.slug, null),
    )
    if (record === null) throw new ProductNotFoundError()
    const [prices, tabs] = await Promise.all([this.prices.get(), this.tabs.get()])
    return toAdminProduct(record, prices, tabs)
  }
}
