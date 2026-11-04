import { canonicalId } from '../../../../shared/domain/id'
import { categoryStorefrontEvent } from '../../domain/catalog-admin-events'
import { CategoryHasProductsError, CategoryNotFoundError } from '../../domain/catalog-admin-errors'
import type { AdminCategoryRepository } from '../ports/admin-category.repository.port'

/** Borrado de una línea desde el dashboard (`DELETE /admin/categories/{id}`). */
export class DeleteCategoryCommand {
  /** @param categories - Líneas del dashboard. */
  constructor(private readonly categories: Pick<AdminCategoryRepository, 'delete'>) {}

  /**
   * Borra una línea sin productos (de ningún estado), renumera las demás y avisa a la tienda
   * (`category.deleted`). Su foto queda en `media_assets`.
   *
   * @param id - Id de la línea (uno que no es UUID no existe; uno en mayúsculas es el mismo).
   * @throws {CategoryNotFoundError} 404 si no existe.
   * @throws {CategoryHasProductsError} 409 si tiene algún producto.
   */
  async execute(id: string): Promise<void> {
    const outcome = await this.categories.delete(
      canonicalId(id),
      categoryStorefrontEvent('category.deleted'),
    )
    if (outcome === 'not_found') throw new CategoryNotFoundError()
    if (outcome === 'has_products') throw new CategoryHasProductsError()
  }
}
