import type { ProductGroup } from '../../domain/category.entity'
import type { Product } from '../../domain/product.entity'
import type { ProductSortOrder } from '../read-models'

/**
 * Filtro del listado de productos publicados. Los filtros se combinan (todos tienen que cumplirse).
 * `ListProductsQuery` lo normaliza antes de pasarlo al repositorio.
 */
export interface ProductFilter {
  /** Slug de la línea. */
  category?: string | undefined
  /** Grupo de producto. */
  group?: ProductGroup | undefined
  /** Ids de producto; una lista vacía no deja ninguno. */
  ids?: string[] | undefined
  /** Texto a buscar sin acentos ni mayúsculas en nombre, descripción y línea. */
  q?: string | undefined
  /** Orden: `destacados` = destacados primero y después por código; los precios "a consultar" al final. */
  sort: ProductSortOrder
  /** Con `true`, solo los destacados. */
  featured?: boolean | undefined
  /** Página, desde 1. */
  page: number
  /** Productos por página, de 1 a 100. */
  pageSize: number
}

/** Una página de productos con el total del filtro. */
export interface ProductList {
  /** Productos de la página, en el orden pedido. */
  items: Product[]
  /** Total de productos que cumplen el filtro. */
  total: number
}

/** Lecturas de productos publicados. */
export interface ProductRepository {
  /**
   * Lista los productos publicados que cumplen el filtro, ordenados y paginados.
   *
   * @param filter - Filtro ya normalizado.
   */
  list(filter: ProductFilter): Promise<ProductList>

  /**
   * Busca un producto publicado por su slug actual o por uno anterior (gana el actual).
   *
   * @param slug - Slug pedido.
   * @returns El producto, o `null` si no hay uno publicado con ese slug.
   */
  findBySlug(slug: string): Promise<Product | null>

  /**
   * Lista los productos publicados de un grupo, por código.
   *
   * @param group - Grupo de producto.
   */
  listPublishedByGroup(group: ProductGroup): Promise<Product[]>
}

/** Token de inyección del {@link ProductRepository}. */
export const PRODUCT_REPOSITORY = Symbol('PRODUCT_REPOSITORY')
