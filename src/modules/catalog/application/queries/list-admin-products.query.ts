import { normalizeSearchText } from '../../domain/search-text'
import type { ProductStatus } from '../../domain/product.entity'
import { toAdminProduct } from '../admin-catalog-views'
import type { AdminProductRepository } from '../ports/admin-product.repository.port'
import type { PriceDisplayPort } from '../ports/price-display.port'
import type { ProductTabsPort } from '../ports/product-tabs.port'
import type { AdminProductPage, ProductSortOrder } from '../read-models'

/** Consulta del listado del dashboard, ya validada (`GET /admin/products`). */
export interface AdminProductQuery {
  /** Texto a buscar en el nombre y el código. */
  q?: string | undefined
  /** Slug de la línea. */
  category?: string | undefined
  /** Estado; sin él, todos menos los archivados. */
  status?: ProductStatus | undefined
  /** Con `out`, solo los que no tienen unidades disponibles. */
  stock?: 'out' | undefined
  /** Orden; sin él, por código. */
  sort?: ProductSortOrder | undefined
  /** Página, desde 1. */
  page: number
  /** Productos por página (1 a 100). */
  pageSize: number
}

/** Listado de productos del dashboard (`GET /admin/products`), sin caché. */
export class ListAdminProductsQuery {
  /**
   * @param products - Productos del dashboard.
   * @param prices - Ajustes de precios (precio sin IVA).
   * @param tabs - Pestañas de cada grupo.
   */
  constructor(
    private readonly products: Pick<AdminProductRepository, 'list'>,
    private readonly prices: PriceDisplayPort,
    private readonly tabs: ProductTabsPort,
  ) {}

  /**
   * Lista los productos en cualquier estado (sin `status`, todos menos los archivados), con los
   * filtros combinados. La búsqueda va sin acentos ni mayúsculas y con los espacios colapsados;
   * una que queda vacía no filtra (como el mock).
   *
   * @param query - Consulta ya validada.
   * @returns La página con la forma `AdminProductPage`.
   * @throws {RangeError} En español, si la página o su tamaño están fuera de rango.
   */
  async execute(query: AdminProductQuery): Promise<AdminProductPage> {
    const { page, pageSize } = query
    if (!Number.isSafeInteger(page) || page < 1) {
      throw new RangeError(`La página tiene que ser un entero desde 1; se recibió ${String(page)}.`)
    }
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
      throw new RangeError(
        `El tamaño de página tiene que ser de 1 a 100; se recibió ${String(pageSize)}.`,
      )
    }
    const search = query.q === undefined ? '' : normalizeSearchText(query.q)
    const [list, prices, tabs] = await Promise.all([
      this.products.list({
        search: search === '' ? null : search,
        status: query.status ?? null,
        stockOut: query.stock === 'out',
        categorySlug: query.category ?? null,
        sort: query.sort ?? null,
        page,
        pageSize,
      }),
      this.prices.get(),
      this.tabs.get(),
    ])
    return {
      items: list.items.map((record) => toAdminProduct(record, prices, tabs)),
      page,
      pageSize,
      total: list.total,
    }
  }
}
