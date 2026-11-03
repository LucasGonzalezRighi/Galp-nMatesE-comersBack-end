import type { FieldError } from '../../../shared/domain/change-notice'
import { DomainError } from '../../../shared/domain/domain-error'

/** `detail` de los 422 de validación (el del contrato). */
const VALIDATION_DETAIL = 'Revisá los campos marcados.'

/** 404 `not_found`: no hay un combo con ese id (o el id no es un UUID). */
export class ComboNotFoundError extends DomainError {
  constructor() {
    super('not_found', 404, 'No existe ese combo.')
    this.name = 'ComboNotFoundError'
  }
}

/**
 * 422 `validation_error` de un combo del dashboard que no se puede guardar (productos que no se
 * venden, de grupos repetidos o un precio que no queda por debajo de la suma), con los errores por
 * campo en `errors`.
 */
export class ComboValidationError extends DomainError {
  /**
   * @param errors - Errores por campo (al menos uno).
   * @throws {TypeError} En español, si no hay errores o alguno está incompleto.
   */
  constructor(errors: readonly FieldError[]) {
    if (errors.length === 0) {
      throw new TypeError('Un error de validación necesita al menos un error de campo')
    }
    super('validation_error', 422, VALIDATION_DETAIL, undefined, { errors })
    this.name = 'ComboValidationError'
  }
}
