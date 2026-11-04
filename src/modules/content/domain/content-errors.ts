import type { FieldError } from '../../../shared/domain/change-notice'
import { DomainError } from '../../../shared/domain/domain-error'

/** `detail` de los 422 de validación (el del contrato). */
const VALIDATION_DETAIL = 'Revisá los campos marcados.'

/**
 * 422 `validation_error` de un contenido que no se puede guardar con lo que hay en la base (por
 * ejemplo, la foto de un socio que el back no conoce), con los errores por campo en `errors`.
 */
export class ContentValidationError extends DomainError {
  /**
   * @param errors - Errores por campo (al menos uno).
   * @throws {TypeError} En español, si no hay errores o alguno está incompleto.
   */
  constructor(errors: readonly FieldError[]) {
    if (errors.length === 0) {
      throw new TypeError('Un error de validación necesita al menos un error de campo')
    }
    super('validation_error', 422, VALIDATION_DETAIL, undefined, { errors })
    this.name = 'ContentValidationError'
  }
}
