import { canonicalId } from '../../../../shared/domain/id'
import { productStorefrontEvent } from '../../domain/catalog-admin-events'
import { SlugTakenError } from '../../domain/catalog-admin-errors'
import { assertProductFields, productWrite } from '../admin-catalog-rules'
import { toAdminProduct } from '../admin-catalog-views'
import type {
  AdminProductFields,
  AdminProductRepository,
} from '../ports/admin-product.repository.port'
import type { PriceDisplayPort } from '../ports/price-display.port'
import type { ProductTabsPort } from '../ports/product-tabs.port'
import type { AdminProduct } from '../read-models'

/** Alta de un producto desde el dashboard (`POST /admin/products`). */
export class CreateProductCommand {
  /**
   * @param products - Productos del dashboard.
   * @param prices - Ajustes de precios (precio sin IVA de la respuesta).
   * @param tabs - Pestañas de cada grupo (las de la respuesta).
   * @param cloudName - Nube con la que se arma la `url` de las fotos nuevas.
   * @throws {TypeError} En español, si la nube está vacía.
   */
  constructor(
    private readonly products: Pick<AdminProductRepository, 'findCategoryGroup' | 'create'>,
    private readonly prices: PriceDisplayPort,
    private readonly tabs: ProductTabsPort,
    private readonly cloudName: string,
  ) {
    if (cloudName.trim() === '') throw new TypeError('Falta la nube de Cloudinary de las fotos.')
  }

  /**
   * Crea el producto (el back le asigna el correlativo) con su stock, sus fotos y su aviso a la
   * tienda (`product.created`) en la misma transacción. Valida en el orden del mock: la línea,
   * los cueros, cada foto y al final el slug.
   *
   * @param fields - Producto con la forma ya validada.
   * @returns El producto creado, con la forma `AdminProduct`.
   * @throws {CatalogValidationError} 422 en `categoryId`, `leathers` o `images.N.publicId`.
   * @throws {SlugTakenError} 409 si otro producto usa el slug (como actual o como anterior).
   * @throws {TypeError | RangeError} En español, si los datos no tienen la forma del formulario.
   */
  async execute(fields: AdminProductFields): Promise<AdminProduct> {
    const input = assertProductFields({ ...fields, categoryId: canonicalId(fields.categoryId) })
    const group = await this.products.findCategoryGroup(input.categoryId)
    const product = productWrite(input, group, [], this.cloudName)
    const outcome = await this.products.create(
      product,
      productStorefrontEvent('product.created', product.slug, null),
    )
    if (outcome.kind !== 'saved') throw new SlugTakenError(product.slug)
    const [prices, tabs] = await Promise.all([this.prices.get(), this.tabs.get()])
    return toAdminProduct(outcome.record, prices, tabs)
  }
}
