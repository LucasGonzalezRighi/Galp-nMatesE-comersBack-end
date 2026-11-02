import type { Product } from '../domain/product.entity'
import type { PriceDisplay } from './ports/price-display.port'
import type { ProductTabsTexts } from './ports/product-tabs.port'
import type { ProductDetail, ProductSummary } from './read-models'

/**
 * Arma el producto de los listados (`ProductSummary`).
 *
 * @param product - Producto publicado.
 * @param prices - Si se muestra el precio sin IVA y con qué alícuota.
 * @returns El producto con código, stock, precio sin IVA y calificación.
 */
export function toProductSummary(product: Product, prices: PriceDisplay): ProductSummary {
  const props = product.toProps()
  return {
    id: props.id,
    slug: props.slug,
    code: product.code(),
    name: props.name,
    description: props.description,
    categoryId: props.category.id,
    categorySlug: props.category.slug,
    categoryName: props.category.name,
    group: props.category.group,
    priceArs: props.priceArs,
    netPriceArs: prices.showNetPrice ? product.netPriceArs(prices.vatRatePercent) : null,
    isPurchasable: product.isPurchasable(),
    isSoldOut: product.isSoldOut(),
    maxQuantity: product.maxQuantity(),
    featured: props.featured,
    mainImage: product.mainImage(),
    rating: props.rating,
  }
}

/**
 * Arma la ficha del producto (`ProductDetail`).
 *
 * @param product - Producto publicado.
 * @param prices - Si se muestra el precio sin IVA y con qué alícuota.
 * @param tabs - Pestañas de cada grupo y texto de envíos.
 * @returns La ficha con fotos, pestañas combinadas y opciones (solo en los mates).
 */
export function toProductDetail(
  product: Product,
  prices: PriceDisplay,
  tabs: ProductTabsTexts,
): ProductDetail {
  return {
    ...toProductSummary(product, prices),
    images: product.toProps().images,
    tabs: product.tabs(tabs[product.group], tabs.shipping),
    options: product.options(),
  }
}
