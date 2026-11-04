import { categoryStorefrontEvent } from '../../domain/catalog-admin-events'
import { SlugTakenError } from '../../domain/catalog-admin-errors'
import { categoryWrite } from '../admin-catalog-rules'
import { toCategoryView } from '../admin-catalog-views'
import type {
  AdminCategoryFields,
  AdminCategoryRepository,
} from '../ports/admin-category.repository.port'
import type { Category } from '../read-models'

/** Alta de una línea desde el dashboard (`POST /admin/categories`). */
export class CreateCategoryCommand {
  /**
   * @param categories - Líneas del dashboard.
   * @param cloudName - Nube con la que se arma la `url` de una foto nueva.
   * @throws {TypeError} En español, si la nube está vacía.
   */
  constructor(
    private readonly categories: Pick<AdminCategoryRepository, 'create'>,
    private readonly cloudName: string,
  ) {
    if (cloudName.trim() === '') throw new TypeError('Falta la nube de Cloudinary de las fotos.')
  }

  /**
   * Crea la línea al final del listado, con su aviso a la tienda (`category.created`).
   *
   * @param fields - Línea con la forma ya validada.
   * @returns La línea creada (`productCount` 0), con la forma `Category`.
   * @throws {CatalogValidationError} 422 `unknown_image` en `image.publicId`.
   * @throws {SlugTakenError} 409 si otra línea usa el slug.
   */
  async execute(fields: AdminCategoryFields): Promise<Category> {
    const category = categoryWrite(fields, null, this.cloudName)
    const outcome = await this.categories.create(
      category,
      categoryStorefrontEvent('category.created'),
    )
    if (outcome.kind !== 'saved') throw new SlugTakenError(category.slug)
    return toCategoryView(outcome.listing)
  }
}
