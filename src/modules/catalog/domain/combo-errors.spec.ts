import { describe, expect, it } from 'vitest'

import { DomainError } from '../../../shared/domain/domain-error'
import { ComboNotFoundError, ComboValidationError } from './combo-errors'

describe('ComboNotFoundError', () => {
  it('es un 404 not_found con el texto del mock', () => {
    const error = new ComboNotFoundError()
    expect(error).toBeInstanceOf(DomainError)
    expect(error.code).toBe('not_found')
    expect(error.status).toBe(404)
    expect(error.detail).toBe('No existe ese combo.')
  })
})

describe('ComboValidationError', () => {
  it('es un 422 validation_error con los errores por campo', () => {
    const errors = [
      {
        field: 'productIds.0',
        code: 'product_unavailable',
        message: 'Elegí un producto publicado y con precio',
      },
    ]
    const error = new ComboValidationError(errors)
    expect(error.code).toBe('validation_error')
    expect(error.status).toBe(422)
    expect(error.detail).toBe('Revisá los campos marcados.')
    expect(error.errors).toEqual(errors)
  })

  it('necesita al menos un error de campo', () => {
    expect(() => new ComboValidationError([])).toThrow(TypeError)
  })
})
