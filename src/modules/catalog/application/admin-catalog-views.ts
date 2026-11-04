import type { PriceDisplay } from './ports/price-display.port'
import type { AdminProductRecord } from './ports/admin-product.repository.port'
import type { CategoryListing } from './ports/category.repository.port'
import type { ProductTabsTexts } from './ports/product-tabs.port'
import { toProductDetail } from './product-views'
import type { AdminProduct, Category, ProductTabsOverrideView } from './read-models'

/**
 * Arma el producto del dashboard (`AdminProduct`): la ficha más el estado, el stock disponible
 * (`on_hand − reserved`, Ruling B-71), el correlativo, los textos propios, los slugs anteriores y
 * las fechas.
 *
 * @param record - Producto guardado.
 * @param prices - Si se muestra el precio sin IVA y con qué alícuota.
 * @param tabs - Pestañas de cada grupo y texto de envíos.
 * @returns El producto con la forma del contrato.
 */
export function toAdminProduct(
  record: AdminProductRecord,
  prices: PriceDisplay,
  tabs: ProductTabsTexts,
): AdminProduct {
  const { product } = record
  const props = product.toProps()
  const override = props.tabsOverride
  const tabsOverride: ProductTabsOverrideView | null =
    override === null || (override.materials === null && override.care === null)
      ? null
      : { materials: override.materials, care: override.care }
  return {
    ...toProductDetail(product, prices, tabs),
    status: props.status,
    stock: props.inventory.onHand - props.inventory.reserved,
    sequence: props.sequence,
    tabsOverride,
    previousSlugs: [...record.previousSlugs],
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  }
}

/**
 * Arma la línea con la forma `Category` del contrato (la misma de `GET /categories`).
 *
 * @param listing - Línea y su cantidad de productos publicados.
 * @returns La línea.
 */
export function toCategoryView({ category, productCount }: CategoryListing): Category {
  return {
    id: category.id,
    slug: category.slug,
    name: category.name,
    group: category.group,
    blurb: category.blurb,
    image: category.image === null ? null : { ...category.image },
    position: category.position,
    productCount,
  }
}
