import type { NewDomainEvent } from '../../../../shared/domain/domain-event'
import type { MediaImage } from '../../../media/domain/media'
import type { ProductGroup } from '../../domain/category.entity'
import type { ImageInput } from './admin-product.repository.port'
import type { CategoryListing, CategoryRepository } from './category.repository.port'

/** Línea que manda el dashboard (`CategoryInput`), con la forma ya validada. */
export interface AdminCategoryFields {
  /** Nombre (2 a 60). */
  name: string
  /** Slug (único entre las líneas). */
  slug: string
  /** Grupo. */
  group: ProductGroup
  /** Bajada (hasta 200, puede ser vacía). */
  blurb: string
  /** Foto, o `null`. */
  image: ImageInput | null
}

/** Línea lista para guardar: la foto ya resuelta. */
export interface CategoryWrite extends Omit<AdminCategoryFields, 'image'> {
  /** Foto resuelta, o `null`. */
  image: MediaImage | null
}

/** Resultado de un alta o una edición de una línea. */
export type CategoryWriteOutcome =
  | { kind: 'saved'; listing: CategoryListing }
  | { kind: 'not_found' }
  | { kind: 'slug_taken' }
  | { kind: 'group_locked' }

/** Resultado de un borrado. */
export type CategoryDeleteOutcome = 'deleted' | 'not_found' | 'has_products'

/**
 * Líneas del dashboard, sin caché. `list` cuenta los productos publicados (como `GET
 * /categories`). Cada escritura va en una transacción con su aviso a la tienda y, después del
 * commit, sube la versión de la caché del catálogo.
 */
export interface AdminCategoryRepository extends CategoryRepository {
  /**
   * Busca una línea por id.
   *
   * @param id - Id canónico (uno que no es UUID no existe).
   */
  findById(id: string): Promise<CategoryListing | null>

  /**
   * Crea una línea al final del listado.
   *
   * @param category - Línea lista para guardar.
   * @param event - Aviso a la tienda.
   * @returns `saved` o `slug_taken` (sin guardar).
   */
  create(category: CategoryWrite, event: NewDomainEvent): Promise<CategoryWriteOutcome>

  /**
   * Reemplaza los datos de una línea; conserva su `position`. No deja cambiar el grupo de una
   * línea con productos (de cualquier estado).
   *
   * @param id - Id canónico.
   * @param category - Línea lista para guardar.
   * @param event - Aviso a la tienda.
   * @returns `saved`, `not_found`, `group_locked` o `slug_taken` (los tres últimos sin guardar).
   */
  update(id: string, category: CategoryWrite, event: NewDomainEvent): Promise<CategoryWriteOutcome>

  /**
   * Borra una línea sin productos y renumera las demás desde 1.
   *
   * @param id - Id canónico.
   * @param event - Aviso a la tienda.
   */
  delete(id: string, event: NewDomainEvent): Promise<CategoryDeleteOutcome>

  /** Ids de todas las líneas, por `position`. */
  listIds(): Promise<string[]>

  /**
   * Fija `position` = lugar en `ids` (desde 1).
   *
   * @param ids - Todas las líneas, una vez cada una.
   * @param event - Aviso a la tienda.
   */
  reorder(ids: readonly string[], event: NewDomainEvent): Promise<void>
}

/** Token de inyección del {@link AdminCategoryRepository}. */
export const ADMIN_CATEGORY_REPOSITORY = Symbol('ADMIN_CATEGORY_REPOSITORY')
