import { canonicalId } from '../../../../shared/domain/id'
import { productStorefrontEvent } from '../../domain/catalog-admin-events'
import {
  ProductChangedError,
  ProductNotFoundError,
  SlugTakenError,
} from '../../domain/catalog-admin-errors'
import { assertProductFields, productWrite } from '../admin-catalog-rules'
import { toAdminProduct } from '../admin-catalog-views'
import type {
  AdminProductFields,
  AdminProductRepository,
} from '../ports/admin-product.repository.port'
import type { PriceDisplayPort } from '../ports/price-display.port'
import type { ProductTabsPort } from '../ports/product-tabs.port'
import type { AdminProduct } from '../read-models'

/**
 * Pasa `expectedUpdatedAt` a una fecha (se compara al milisegundo, como `Date.parse` del mock).
 *
 * @throws {TypeError} En español, si no es una fecha.
 */
function expectedDate(expectedUpdatedAt: string | null): Date | null {
  if (expectedUpdatedAt === null) return null
  const time = Date.parse(expectedUpdatedAt)
  if (Number.isNaN(time)) {
    throw new TypeError(`"${expectedUpdatedAt}" no es una fecha de última modificación.`)
  }
  return new Date(time)
}

/** Modificación de un producto desde el dashboard (`PATCH /admin/products/{id}`). */
export class UpdateProductCommand {
  /**
   * @param products - Productos del dashboard.
   * @param prices - Ajustes de precios (precio sin IVA de la respuesta).
   * @param tabs - Pestañas de cada grupo (las de la respuesta).
   * @param cloudName - Nube con la que se arma la `url` de las fotos nuevas.
   * @throws {TypeError} En español, si la nube está vacía.
   */
  constructor(
    private readonly products: Pick<
      AdminProductRepository,
      'findById' | 'findCategoryGroup' | 'update'
    >,
    private readonly prices: PriceDisplayPort,
    private readonly tabs: ProductTabsPort,
    private readonly cloudName: string,
  ) {
    if (cloudName.trim() === '') throw new TypeError('Falta la nube de Cloudinary de las fotos.')
  }

  /**
   * Reemplaza los datos editables del producto, con su aviso a la tienda (`product.updated`, con
   * el slug anterior si cambió) en la misma transacción. Orden del mock: 404, después el 409
   * `product_changed` (antes que la línea, los cueros, las fotos y el slug), los 422 y al final
   * el 409 `slug_taken`. Las fotos que ya tenía conservan su `url`; el stock es lo disponible
   * (`on_hand = stock + reserved`).
   *
   * @param id - Id del producto (uno que no es UUID no existe; uno en mayúsculas es el mismo).
   * @param fields - Producto completo, con la forma ya validada.
   * @param expectedUpdatedAt - `updatedAt` que vio el dashboard, o `null` para guardar igual.
   * @returns El producto modificado, con la forma `AdminProduct`.
   * @throws {ProductNotFoundError} 404 si no existe.
   * @throws {ProductChangedError} 409 si `expectedUpdatedAt` no coincide con el guardado.
   * @throws {CatalogValidationError} 422 en `categoryId`, `leathers` o `images.N.publicId`.
   * @throws {SlugTakenError} 409 si otro producto usa el slug.
   * @throws {TypeError | RangeError} En español, si los datos no tienen la forma del formulario.
   */
  async execute(
    id: string,
    fields: AdminProductFields,
    expectedUpdatedAt: string | null,
  ): Promise<AdminProduct> {
    const productId = canonicalId(id)
    const input = assertProductFields({ ...fields, categoryId: canonicalId(fields.categoryId) })
    const expected = expectedDate(expectedUpdatedAt)
    const current = await this.products.findById(productId)
    if (current === null) throw new ProductNotFoundError()
    if (expected !== null && expected.getTime() !== current.updatedAt.getTime()) {
      throw new ProductChangedError()
    }
    const group = await this.products.findCategoryGroup(input.categoryId)
    const product = productWrite(input, group, current.product.toProps().images, this.cloudName)
    const outcome = await this.products.update(
      productId,
      product,
      expected,
      productStorefrontEvent('product.updated', product.slug, current.product.slug),
    )
    if (outcome.kind === 'not_found') throw new ProductNotFoundError()
    if (outcome.kind === 'changed') throw new ProductChangedError()
    if (outcome.kind === 'slug_taken') throw new SlugTakenError(product.slug)
    const [prices, tabs] = await Promise.all([this.prices.get(), this.tabs.get()])
    return toAdminProduct(outcome.record, prices, tabs)
  }
}
