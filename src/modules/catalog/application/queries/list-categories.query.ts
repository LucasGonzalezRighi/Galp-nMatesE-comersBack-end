import type { CategoryRepository } from '../ports/category.repository.port'
import type { Category } from '../read-models'

/** Líneas del catálogo (`GET /categories`). */
export class ListCategoriesQuery {
  /** @param categories - Lecturas de líneas. */
  constructor(private readonly categories: CategoryRepository) {}

  /**
   * Devuelve todas las líneas por posición, con la cantidad de productos publicados de cada una.
   *
   * @returns Las líneas con la forma `Category` del contrato.
   */
  async execute(): Promise<Category[]> {
    const listings = await this.categories.list()
    return listings
      .toSorted((a, b) => a.category.position - b.category.position)
      .map(({ category, productCount }) => ({
        id: category.id,
        slug: category.slug,
        name: category.name,
        group: category.group,
        blurb: category.blurb,
        image: category.image === null ? null : { ...category.image },
        position: category.position,
        productCount,
      }))
  }
}
