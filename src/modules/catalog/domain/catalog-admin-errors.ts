import type { FieldError } from '../../../shared/domain/change-notice'
import { DomainError } from '../../../shared/domain/domain-error'

/** Textos de los productos y las líneas del dashboard (los del mock y del front). */
export const CATALOG_ADMIN_MESSAGES = {
  /** 404 de un producto (`findProduct` del mock). */
  productNotFound: 'No existe ese producto.',
  /** 404 de una línea (`findCategory` del mock). */
  categoryNotFound: 'No existe esa línea.',
  /** 422 `unknown_category` en `categoryId`. */
  unknownCategory: 'Esa línea no existe',
  /** 422 `leathers_not_allowed` en `leathers` (`MESSAGES.leathersOnlyMates` del front). */
  leathersOnlyMates: 'Solo los mates llevan colores',
  /** 422 `category_has_products` en `group` (propio del back, Ruling B-81). */
  groupHasProducts: 'La línea tiene productos: mové los productos antes de cambiarle el grupo.',
  /** 422 `invalid_value` en `ids` del orden de las líneas. */
  incompleteOrder: 'El orden tiene que tener todas las líneas, una vez cada una.',
} as const

/** `detail` de los 422 de validación (el del contrato). */
const VALIDATION_DETAIL = 'Revisá los campos marcados.'

/** 404 `not_found`: no hay un producto con ese id (o el id no es un UUID). */
export class ProductNotFoundError extends DomainError {
  constructor() {
    super('not_found', 404, CATALOG_ADMIN_MESSAGES.productNotFound)
    this.name = 'ProductNotFoundError'
  }
}

/** 404 `not_found`: no hay una línea con ese id (o el id no es un UUID). */
export class CategoryNotFoundError extends DomainError {
  constructor() {
    super('not_found', 404, CATALOG_ADMIN_MESSAGES.categoryNotFound)
    this.name = 'CategoryNotFoundError'
  }
}

/**
 * 409 `slug_taken`: el slug ya lo usa otro producto (como actual o como anterior) u otra línea.
 */
export class SlugTakenError extends DomainError {
  /**
   * @param slug - Slug pedido.
   * @throws {TypeError} En español, si el slug está vacío.
   */
  constructor(slug: string) {
    if (slug.trim() === '') throw new TypeError('Falta el slug que ya está en uso.')
    super('slug_taken', 409, `Ya hay algo con el slug ${slug}.`, 'El slug ya está en uso')
    this.name = 'SlugTakenError'
  }
}

/** 409 `product_changed`: vino `expectedUpdatedAt` y no coincide con el `updatedAt` guardado. */
export class ProductChangedError extends DomainError {
  constructor() {
    super('product_changed', 409, 'El producto cambió desde que lo abriste.', 'El producto cambió')
    this.name = 'ProductChangedError'
  }
}

/** 409 `category_has_products`: se quiso borrar una línea que tiene productos (de cualquier estado). */
export class CategoryHasProductsError extends DomainError {
  constructor() {
    super(
      'category_has_products',
      409,
      'Mové o borrá los productos de la línea antes de borrarla.',
      'La línea tiene productos',
    )
    this.name = 'CategoryHasProductsError'
  }
}

/**
 * 422 `validation_error` de un producto o una línea que no se puede guardar por lo que hay en la
 * base (línea que no existe, cueros fuera de un mate, foto desconocida, orden incompleto, grupo
 * de una línea con productos), con los errores por campo en `errors`.
 */
export class CatalogValidationError extends DomainError {
  /**
   * @param errors - Errores por campo (al menos uno).
   * @throws {TypeError} En español, si no hay errores o alguno está incompleto.
   */
  constructor(errors: readonly FieldError[]) {
    if (errors.length === 0) {
      throw new TypeError('Un error de validación necesita al menos un error de campo')
    }
    super('validation_error', 422, VALIDATION_DETAIL, undefined, { errors })
    this.name = 'CatalogValidationError'
  }
}
