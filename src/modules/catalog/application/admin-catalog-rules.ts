// Reglas de los productos y las líneas del dashboard que miran la base o las fotos (los 422 del
// mock, `productFields` y `categoryFields` de `handlers/admin-products.ts` y
// `admin-categories.ts`), en el orden del mock: la línea, los cueros y después cada foto; cortan en
// el primer error, como el mock.

import type { FieldError } from '../../../shared/domain/change-notice'
import { type MediaImage, type MediaPurpose, resolveImage } from '../../media/domain/media'
import type { ProductGroup } from '../domain/category.entity'
import { CATALOG_ADMIN_MESSAGES, CatalogValidationError } from '../domain/catalog-admin-errors'
import { normalizeLeathers } from '../domain/product.entity'
import type { AdminCategoryFields, CategoryWrite } from './ports/admin-category.repository.port'
import type {
  AdminProductFields,
  ImageInput,
  ProductWrite,
} from './ports/admin-product.repository.port'

/** Estados que acepta el formulario de productos. */
const EDITABLE_STATUSES: readonly string[] = ['draft', 'published']

/** Máximo de fotos de un producto (`MAX_PRODUCT_IMAGES` del front). */
export const MAX_PRODUCT_IMAGES = 8

/** Máximo de unidades en stock del formulario. */
export const MAX_PRODUCT_STOCK = 9999

/**
 * Revisa que los datos de un producto tengan la forma de `AdminProductInput` (lo que el DTO ya
 * garantiza) y deja los cueros en el orden canónico.
 *
 * @param fields - Producto del dashboard.
 * @returns Una copia con los cueros normalizados.
 * @throws {TypeError} En español, si falta un texto obligatorio o el estado no es editable.
 * @throws {RangeError} En español, si el precio, el stock, las fotos o los cueros no sirven.
 */
export function assertProductFields(fields: AdminProductFields): AdminProductFields {
  for (const [name, value] of Object.entries({
    name: fields.name,
    slug: fields.slug,
    categoryId: fields.categoryId,
    description: fields.description,
  })) {
    if (value.trim() === '') throw new TypeError(`Falta el campo ${name} del producto.`)
  }
  if (!EDITABLE_STATUSES.includes(fields.status)) {
    throw new TypeError(`El estado "${fields.status}" no se puede guardar desde el formulario.`)
  }
  if (fields.priceArs !== null && (!Number.isSafeInteger(fields.priceArs) || fields.priceArs < 1)) {
    throw new RangeError(
      `El precio tiene que ser un entero desde 1 o null; se recibió ${String(fields.priceArs)}.`,
    )
  }
  if (!Number.isInteger(fields.stock) || fields.stock < 0 || fields.stock > MAX_PRODUCT_STOCK) {
    throw new RangeError(
      `El stock tiene que ser un entero de 0 a 9999; se recibió ${String(fields.stock)}.`,
    )
  }
  if (fields.images.length > MAX_PRODUCT_IMAGES) {
    throw new RangeError(`Un producto lleva hasta ${String(MAX_PRODUCT_IMAGES)} fotos.`)
  }
  return {
    ...fields,
    tabsOverride: fields.tabsOverride === null ? null : { ...fields.tabsOverride },
    images: fields.images.map((image) => ({ ...image })),
    leathers: normalizeLeathers(fields.leathers),
  }
}

/** Lanza el 422 de un solo campo. */
function fail(error: FieldError): never {
  throw new CatalogValidationError([error])
}

/**
 * Resuelve las fotos de un recurso con `resolveImage` (Ruling B-74): corta en la primera que el
 * back no conoce.
 *
 * @param images - Fotos del cuerpo.
 * @param purpose - Uso (define la carpeta).
 * @param stored - Fotos que el recurso ya tiene.
 * @param cloudName - Nube de las fotos nuevas.
 * @param field - Ruta de cada foto en el cuerpo, por índice (`images.N`) o fija (`image`).
 * @returns Las fotos con su `url`.
 * @throws {CatalogValidationError} 422 `unknown_image` en `{field}.publicId`.
 */
function resolveAll(
  images: readonly ImageInput[],
  purpose: MediaPurpose,
  stored: readonly MediaImage[],
  cloudName: string,
  field: (index: number) => string,
): MediaImage[] {
  return images.map((image, index) => {
    const resolved = resolveImage(image, { purpose, stored, cloudName, field: field(index) })
    return resolved.ok ? resolved.image : fail(resolved.error)
  })
}

/**
 * Valida un producto contra la base (línea, cueros y fotos, en ese orden) y lo deja listo para
 * guardar.
 *
 * @param fields - Producto ya normalizado ({@link assertProductFields}).
 * @param group - Grupo de su línea, o `null` si la línea no existe.
 * @param stored - Fotos que el producto ya tiene (conservan su `url`).
 * @param cloudName - Nube de las fotos nuevas.
 * @returns El producto con las fotos resueltas.
 * @throws {CatalogValidationError} 422 en `categoryId` (`unknown_category`), en `leathers`
 *   (`leathers_not_allowed`) o en `images.N.publicId` (`unknown_image`).
 */
export function productWrite(
  fields: AdminProductFields,
  group: ProductGroup | null,
  stored: readonly MediaImage[],
  cloudName: string,
): ProductWrite {
  if (group === null) {
    fail({
      field: 'categoryId',
      code: 'unknown_category',
      message: CATALOG_ADMIN_MESSAGES.unknownCategory,
    })
  }
  if (group !== 'mate' && fields.leathers.length > 0) {
    fail({
      field: 'leathers',
      code: 'leathers_not_allowed',
      message: CATALOG_ADMIN_MESSAGES.leathersOnlyMates,
    })
  }
  const images = resolveAll(
    fields.images,
    'product',
    stored,
    cloudName,
    (index) => `images.${String(index)}`,
  )
  return { ...fields, images }
}

/**
 * Deja una línea lista para guardar: resuelve su foto (la que ya tenía conserva su `url`).
 *
 * @param fields - Línea del dashboard.
 * @param stored - Foto guardada de la línea, o `null`.
 * @param cloudName - Nube de las fotos nuevas.
 * @returns La línea con la foto resuelta.
 * @throws {CatalogValidationError} 422 `unknown_image` en `image.publicId`.
 * @throws {TypeError} En español, si falta el nombre o el slug.
 */
export function categoryWrite(
  fields: AdminCategoryFields,
  stored: MediaImage | null,
  cloudName: string,
): CategoryWrite {
  if (fields.name.trim() === '' || fields.slug.trim() === '') {
    throw new TypeError('Una línea necesita su nombre y su slug.')
  }
  const [image = null] =
    fields.image === null
      ? []
      : resolveAll(
          [fields.image],
          'category',
          stored === null ? [] : [stored],
          cloudName,
          () => 'image',
        )
  return { ...fields, image }
}

/**
 * Valida un orden nuevo de las líneas: tiene que traerlas todas, una vez cada una.
 *
 * @param ids - Ids del orden nuevo, canónicos.
 * @param currentIds - Ids de todas las líneas guardadas.
 * @returns `[]` si sirve; si no, el error de `ids` con `invalid_value`.
 */
export function categoryOrderErrors(
  ids: readonly string[],
  currentIds: readonly string[],
): FieldError[] {
  const current = new Set(currentIds)
  const complete =
    ids.length === current.size &&
    new Set(ids).size === ids.length &&
    ids.every((id) => current.has(id))
  return complete
    ? []
    : [{ field: 'ids', code: 'invalid_value', message: CATALOG_ADMIN_MESSAGES.incompleteOrder }]
}
