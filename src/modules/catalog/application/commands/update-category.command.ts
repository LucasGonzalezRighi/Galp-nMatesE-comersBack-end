import { canonicalId } from '../../../../shared/domain/id'
import { categoryStorefrontEvent } from '../../domain/catalog-admin-events'
import {
  CATALOG_ADMIN_MESSAGES,
  CatalogValidationError,
  CategoryNotFoundError,
  SlugTakenError,
} from '../../domain/catalog-admin-errors'
import { categoryWrite } from '../admin-catalog-rules'
import { toCategoryView } from '../admin-catalog-views'
import type {
  AdminCategoryFields,
  AdminCategoryRepository,
} from '../ports/admin-category.repository.port'
import type { Category } from '../read-models'

/** Modificación de una línea desde el dashboard (`PATCH /admin/categories/{id}`). */
export class UpdateCategoryCommand {
  /**
   * @param categories - Líneas del dashboard.
   * @param cloudName - Nube con la que se arma la `url` de una foto nueva.
   * @throws {TypeError} En español, si la nube está vacía.
   */
  constructor(
    private readonly categories: Pick<AdminCategoryRepository, 'findById' | 'update'>,
    private readonly cloudName: string,
  ) {
    if (cloudName.trim() === '') throw new TypeError('Falta la nube de Cloudinary de las fotos.')
  }

  /**
   * Reemplaza los datos de la línea (conserva su `position`), con su aviso a la tienda
   * (`category.updated`). La foto que ya tenía conserva su `url`. Cambiar el grupo de una línea
   * con productos no se deja (protege los combos y los cueros; Ruling B-81).
   *
   * @param id - Id de la línea (uno que no es UUID no existe; uno en mayúsculas es el mismo).
   * @param fields - Línea completa, con la forma ya validada.
   * @returns La línea modificada, con la forma `Category`.
   * @throws {CategoryNotFoundError} 404 si no existe.
   * @throws {CatalogValidationError} 422 en `image.publicId` (`unknown_image`) o en `group`
   *   (`category_has_products`).
   * @throws {SlugTakenError} 409 si otra línea usa el slug.
   */
  async execute(id: string, fields: AdminCategoryFields): Promise<Category> {
    const categoryId = canonicalId(id)
    const current = await this.categories.findById(categoryId)
    if (current === null) throw new CategoryNotFoundError()
    const category = categoryWrite(fields, current.category.image, this.cloudName)
    const outcome = await this.categories.update(
      categoryId,
      category,
      categoryStorefrontEvent('category.updated'),
    )
    if (outcome.kind === 'not_found') throw new CategoryNotFoundError()
    if (outcome.kind === 'slug_taken') throw new SlugTakenError(category.slug)
    if (outcome.kind === 'group_locked') {
      throw new CatalogValidationError([
        {
          field: 'group',
          code: 'category_has_products',
          message: CATALOG_ADMIN_MESSAGES.groupHasProducts,
        },
      ])
    }
    return toCategoryView(outcome.listing)
  }
}
