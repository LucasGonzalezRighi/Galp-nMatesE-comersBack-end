import { describe, expect, it } from 'vitest'

import { CHANGE_KINDS, type ChangeNotice } from './change-notice'
import { DomainError } from './domain-error'

describe('DomainError', () => {
  it('guarda una copia de los changes y de los errors', () => {
    const changes: ChangeNotice[] = [{ kind: 'stock', productId: 'p1', message: 'Sin stock.' }]
    const errors = [{ field: 'shipping.method', code: 'unavailable', message: 'No está.' }]

    const conflict = new DomainError('stock_changed', 409, 'Cambió.', undefined, { changes })
    const invalid = new DomainError('validation_error', 422, 'Revisá.', undefined, { errors })
    changes.push({ kind: 'price', productId: null, message: 'Otro.' })

    expect(conflict.changes).toEqual([{ kind: 'stock', productId: 'p1', message: 'Sin stock.' }])
    expect(conflict.errors).toBeUndefined()
    expect(invalid.errors).toEqual(errors)
    expect(invalid.changes).toBeUndefined()
  })

  it('acepta los cinco tipos de cambio del contrato', () => {
    expect(CHANGE_KINDS).toEqual(['price', 'stock', 'discount', 'shipping', 'unavailable'])
  })

  it('rechaza un change con un tipo desconocido o sin mensaje', () => {
    const unknownKind = [
      { kind: 'color', productId: null, message: 'x' },
    ] as unknown as ChangeNotice[]

    expect(
      () => new DomainError('stock_changed', 409, 'Cambió.', undefined, { changes: unknownKind }),
    ).toThrow(TypeError)
    expect(
      () =>
        new DomainError('stock_changed', 409, 'Cambió.', undefined, {
          changes: [{ kind: 'stock', productId: 'p1', message: ' ' }],
        }),
    ).toThrow('Cada aviso de cambio necesita un tipo del contrato y un mensaje')
  })

  it('rechaza un error de campo sin field, code o message', () => {
    expect(
      () =>
        new DomainError('validation_error', 422, 'Revisá.', undefined, {
          errors: [{ field: '', code: 'required', message: 'Requerido' }],
        }),
    ).toThrow('Cada error de campo necesita field, code y message')
  })
})
