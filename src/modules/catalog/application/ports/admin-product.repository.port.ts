import type { NewDomainEvent } from '../../../../shared/domain/domain-event'
import type { MediaImage } from '../../../media/domain/media'
import type { ProductGroup } from '../../domain/category.entity'
import type { Leather, Product, ProductStatus, TabsOverride } from '../../domain/product.entity'
import type { ProductSortOrder } from '../read-models'

/** Estados que se pueden guardar desde el formulario (archivar va por su propia ruta). */
export type EditableProductStatus = Exclude<ProductStatus, 'archived'>

/** Foto como la manda el dashboard (`ImageInput`): sin `url`, la arma el back. */
export type ImageInput = Omit<MediaImage, 'url'>

/** Producto que manda el dashboard (`AdminProductInput`), con la forma ya validada. */
export interface AdminProductFields {
  /** Nombre (3 a 120). */
  name: string
  /** Slug (único entre los actuales y los anteriores de otros productos). */
  slug: string
  /** Id de la línea. */
  categoryId: string
  /** Descripción (10 a 2000). */
  description: string
  /** Precio final en pesos, o `null` ("a consultar"). */
  priceArs: number | null
  /** Unidades disponibles (0 a 9999). */
  stock: number
  /** Si es destacado. */
  featured: boolean
  /** Borrador o publicado. */
  status: EditableProductStatus
  /** Textos propios de las pestañas, o `null` si usa los del grupo. */
  tabsOverride: TabsOverride | null
  /** Fotos (hasta 8; la primera es la principal). */
  images: ImageInput[]
  /** Cueros que ofrece, en el orden de `LEATHERS`. */
  leathers: Leather[]
}

/** Producto listo para guardar: las fotos ya resueltas (con su `url`). */
export interface ProductWrite extends Omit<AdminProductFields, 'images'> {
  /** Fotos resueltas, en orden. */
  images: MediaImage[]
}

/** Producto guardado con lo que solo ve el dashboard. */
export interface AdminProductRecord {
  /** El producto (en cualquier estado). */
  product: Product
  /** Slugs anteriores, del más viejo al más nuevo. */
  previousSlugs: string[]
  /** Alta. */
  createdAt: Date
  /** Última modificación (al milisegundo). */
  updatedAt: Date
}

/** Filtros del listado del dashboard, ya normalizados. */
export interface AdminProductFilter {
  /** Texto a buscar en el nombre y el código (`normalizeSearchText`), o `null`. */
  search: string | null
  /** Solo ese estado; `null` = todos menos los archivados. */
  status: ProductStatus | null
  /** Solo los que no tienen unidades disponibles. */
  stockOut: boolean
  /** Slug de la línea, o `null`. */
  categorySlug: string | null
  /** Orden; `null` = por `sequence`. */
  sort: ProductSortOrder | null
  /** Página, desde 1. */
  page: number
  /** Productos por página (1 a 100). */
  pageSize: number
}

/** Página del listado del dashboard. */
export interface AdminProductList {
  /** Productos de la página. */
  items: AdminProductRecord[]
  /** Total que cumple los filtros. */
  total: number
}

/** Resultado de un alta o una edición. */
export type ProductWriteOutcome =
  | { kind: 'saved'; record: AdminProductRecord }
  | { kind: 'not_found' }
  | { kind: 'changed' }
  | { kind: 'slug_taken' }

/**
 * Productos del dashboard, en cualquier estado y sin caché. Cada escritura va en una transacción
 * con su aviso a la tienda y, después del commit, sube la versión de la caché del catálogo.
 */
export interface AdminProductRepository {
  /**
   * Lista con filtros, orden y página.
   *
   * @param filter - Filtros ya normalizados.
   */
  list(filter: AdminProductFilter): Promise<AdminProductList>

  /**
   * Busca un producto por id, en cualquier estado.
   *
   * @param id - Id canónico (uno que no es UUID no existe).
   */
  findById(id: string): Promise<AdminProductRecord | null>

  /**
   * Grupo de una línea, o `null` si no existe.
   *
   * @param categoryId - Id canónico de la línea.
   */
  findCategoryGroup(categoryId: string): Promise<ProductGroup | null>

  /**
   * Crea un producto con su stock, sus fotos y su aviso. El slug no puede ser el actual ni uno
   * anterior de otro producto.
   *
   * @param product - Producto listo para guardar.
   * @param event - Aviso a la tienda (en la misma transacción).
   * @returns `saved` o `slug_taken` (sin guardar nada).
   */
  create(product: ProductWrite, event: NewDomainEvent): Promise<ProductWriteOutcome>

  /**
   * Reemplaza los datos de un producto (`on_hand = stock + reserved`; si cambia el slug, el
   * anterior pasa al historial).
   *
   * @param id - Id canónico.
   * @param product - Producto listo para guardar.
   * @param expectedUpdatedAt - `updatedAt` que vio el dashboard, o `null` (gana el último).
   * @param event - Aviso a la tienda (en la misma transacción).
   * @returns `saved`, `not_found`, `changed` o `slug_taken` (los tres últimos sin guardar).
   */
  update(
    id: string,
    product: ProductWrite,
    expectedUpdatedAt: Date | null,
    event: NewDomainEvent,
  ): Promise<ProductWriteOutcome>

  /**
   * Archiva un producto (si ya lo estaba no cambia nada, pero avisa igual, como el mock).
   *
   * @param id - Id canónico.
   * @param event - Aviso a la tienda (en la misma transacción).
   * @returns El producto, o `null` si no existe.
   */
  archive(id: string, event: NewDomainEvent): Promise<AdminProductRecord | null>
}

/** Token de inyección del {@link AdminProductRepository}. */
export const ADMIN_PRODUCT_REPOSITORY = Symbol('ADMIN_PRODUCT_REPOSITORY')
