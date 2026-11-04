import { canonicalId } from '../../../../shared/domain/id'
import { categoryStorefrontEvent } from '../../domain/catalog-admin-events'
import { CatalogValidationError } from '../../domain/catalog-admin-errors'
import { categoryOrderErrors } from '../admin-catalog-rules'
import type { AdminCategoryRepository } from '../ports/admin-category.repository.port'

/** Orden de las líneas desde el dashboard (`PUT /admin/categories/order`). */
export class ReorderCategoriesCommand {
  /** @param categories - Líneas del dashboard. */
  constructor(private readonly categories: Pick<AdminCategoryRepository, 'listIds' | 'reorder'>) {}

  /**
   * Fija `position` = lugar de cada línea en `ids` (desde 1), con su aviso a la tienda
   * (`category.reordered`).
   *
   * @param ids - Todas las líneas, una vez cada una, en el orden nuevo (un UUID en mayúsculas es
   *   la misma línea).
   * @throws {CatalogValidationError} 422 en `ids` si falta una línea, sobra una, se repite o no
   *   existe.
   */
  async execute(ids: readonly string[]): Promise<void> {
    const order = ids.map(canonicalId)
    const errors = categoryOrderErrors(order, await this.categories.listIds())
    if (errors.length > 0) throw new CatalogValidationError(errors)
    await this.categories.reorder(order, categoryStorefrontEvent('category.reordered'))
  }
}
