import { isProductGroup } from '../../domain/category.entity'
import { normalizeSearchText } from '../../domain/search-text'
import type { PriceDisplayPort } from '../ports/price-display.port'
import type { ProductFilter, ProductRepository } from '../ports/product.repository.port'
import { toProductSummary } from '../product-views'
import { PRODUCT_SORT_ORDERS, type ProductPage } from '../read-models'

/** Máximo de productos por página del contrato. */
export const MAX_PRODUCTS_PAGE_SIZE = 100

/**
 * Valida y normaliza el filtro: búsqueda normalizada (sin acentos, minúsculas, espacios
 * colapsados; vacía = sin búsqueda), ids recortados, únicos y ordenados, y `featured` solo si es
 * `true`. Así filtros equivalentes comparten la misma clave de caché.
 *
 * @throws {RangeError} En español, si la página, el tamaño, el orden o el grupo no son válidos.
 */
function normalizeFilter(filter: ProductFilter): ProductFilter {
  if (!Number.isInteger(filter.page) || filter.page < 1) {
    throw new RangeError(
      `La página tiene que ser un entero desde 1; se recibió ${String(filter.page)}.`,
    )
  }
  if (
    !Number.isInteger(filter.pageSize) ||
    filter.pageSize < 1 ||
    filter.pageSize > MAX_PRODUCTS_PAGE_SIZE
  ) {
    throw new RangeError(
      `El tamaño de página tiene que ser un entero de 1 a ${String(MAX_PRODUCTS_PAGE_SIZE)}; se recibió ${String(filter.pageSize)}.`,
    )
  }
  if (!(PRODUCT_SORT_ORDERS as readonly string[]).includes(filter.sort)) {
    throw new RangeError(`El orden "${filter.sort}" no existe.`)
  }
  if (filter.group !== undefined && !isProductGroup(filter.group)) {
    throw new RangeError(`El grupo "${String(filter.group)}" no existe.`)
  }

  const normalized: ProductFilter = {
    sort: filter.sort,
    page: filter.page,
    pageSize: filter.pageSize,
  }
  if (filter.category !== undefined) normalized.category = filter.category
  if (filter.group !== undefined) normalized.group = filter.group
  if (filter.ids !== undefined) {
    const ids = filter.ids.map((id) => id.trim()).filter((id) => id !== '')
    normalized.ids = [...new Set(ids)].sort()
  }
  const q = filter.q === undefined ? '' : normalizeSearchText(filter.q)
  if (q !== '') normalized.q = q
  if (filter.featured === true) normalized.featured = true
  return normalized
}

/** Listado paginado de productos publicados (`GET /products`). */
export class ListProductsQuery {
  /**
   * @param products - Lecturas de productos.
   * @param prices - Ajustes de precios (precio sin IVA).
   */
  constructor(
    private readonly products: ProductRepository,
    private readonly prices: PriceDisplayPort,
  ) {}

  /**
   * Lista los productos publicados que cumplen el filtro.
   *
   * @param filter - Filtro del pedido; se valida y normaliza acá.
   * @returns La página con la forma `ProductPage` del contrato.
   * @throws {RangeError} En español, si la paginación, el orden o el grupo no son válidos.
   */
  async execute(filter: ProductFilter): Promise<ProductPage> {
    const normalized = normalizeFilter(filter)
    const [list, prices] = await Promise.all([this.products.list(normalized), this.prices.get()])
    return {
      items: list.items.map((product) => toProductSummary(product, prices)),
      page: normalized.page,
      pageSize: normalized.pageSize,
      total: list.total,
    }
  }
}
