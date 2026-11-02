import type { Category } from '../../domain/category.entity'

/** Línea con la cantidad de productos publicados que tiene. */
export interface CategoryListing {
  /** La línea. */
  category: Category
  /** Productos publicados de la línea. */
  productCount: number
}

/** Lecturas de las líneas del catálogo. */
export interface CategoryRepository {
  /** Todas las líneas, por posición, con su cantidad de productos publicados. */
  list(): Promise<CategoryListing[]>
}

/** Token de inyección del {@link CategoryRepository}. */
export const CATEGORY_REPOSITORY = Symbol('CATEGORY_REPOSITORY')
