import { canonicalId } from '../../../../shared/domain/id'
import { ProductNotFoundError } from '../../domain/catalog-admin-errors'
import { toAdminProduct } from '../admin-catalog-views'
import type { AdminProductRepository } from '../ports/admin-product.repository.port'
import type { PriceDisplayPort } from '../ports/price-display.port'
import type { ProductTabsPort } from '../ports/product-tabs.port'
import type { AdminProduct } from '../read-models'

/** Un producto del dashboard (`GET /admin/products/{id}`), en cualquier estado y sin caché. */
export class GetAdminProductQuery {
  /**
   * @param products - Productos del dashboard.
   * @param prices - Ajustes de precios (precio sin IVA).
   * @param tabs - Pestañas de cada grupo.
   */
  constructor(
    private readonly products: Pick<AdminProductRepository, 'findById'>,
    private readonly prices: PriceDisplayPort,
    private readonly tabs: ProductTabsPort,
  ) {}

  /**
   * Busca el producto por id.
   *
   * @param id - Id del producto (uno que no es UUID no existe; uno en mayúsculas es el mismo).
   * @returns El producto con la forma `AdminProduct`.
   * @throws {ProductNotFoundError} 404 si no existe.
   */
  async execute(id: string): Promise<AdminProduct> {
    const record = await this.products.findById(canonicalId(id))
    if (record === null) throw new ProductNotFoundError()
    const [prices, tabs] = await Promise.all([this.prices.get(), this.tabs.get()])
    return toAdminProduct(record, prices, tabs)
  }
}
