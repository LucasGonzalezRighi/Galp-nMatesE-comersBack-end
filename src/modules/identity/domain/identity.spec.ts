import { describe, expect, it } from 'vitest'

import { DomainError } from '../../../shared/domain/domain-error'
import { normalizeAddressInput } from './address.entity'
import { normalizePersonName } from './customer.entity'
import { normalizeEmail } from './email'
import {
  AccountDisabledError,
  AddressNotFoundError,
  EmailAlreadyRegisteredError,
  InvalidCredentialsError,
  LoginLockedError,
} from './identity-errors'
import { isProvince, PROVINCES } from './province'

describe('normalizeEmail', () => {
  it('saca los espacios de alrededor y pasa a minúsculas', () => {
    expect(normalizeEmail(' Ana@Mail.com ')).toBe('ana@mail.com')
  })

  it('rechaza un email vacío', () => {
    expect(() => normalizeEmail('   ')).toThrow(TypeError)
  })
})

describe('PROVINCES', () => {
  it('son las 24 del contrato, con CABA y Tierra del Fuego', () => {
    expect(PROVINCES).toHaveLength(24)
    expect(PROVINCES).toContain('CABA')
    expect(PROVINCES).toContain('Tierra del Fuego')
    expect(isProvince('Córdoba')).toBe(true)
    expect(isProvince('Cordoba')).toBe(false)
  })
})

describe('normalización de nombres y direcciones', () => {
  it('saca los espacios de alrededor de un nombre', () => {
    expect(normalizePersonName('  Lucía ')).toBe('Lucía')
    expect(() => normalizePersonName('  ')).toThrow(TypeError)
  })

  it('pasa número y código postal a mayúsculas y recorta los textos', () => {
    expect(
      normalizeAddressInput({
        label: ' Casa ',
        street: ' Av. Corrientes ',
        number: 's/n',
        apartment: ' 5° B ',
        postalCode: 'c1414abc',
        city: ' CABA ',
        province: 'CABA',
        isDefault: true,
      }),
    ).toEqual({
      label: 'Casa',
      street: 'Av. Corrientes',
      number: 'S/N',
      apartment: '5° B',
      postalCode: 'C1414ABC',
      city: 'CABA',
      province: 'CABA',
      isDefault: true,
    })
  })

  it('deja en null la etiqueta y el departamento vacíos y rechaza una provincia desconocida', () => {
    const base = {
      label: null,
      street: 'Calle',
      number: '12',
      apartment: null,
      postalCode: '8300',
      city: 'Neuquén',
      province: 'Neuquén' as const,
      isDefault: false,
    }
    expect(normalizeAddressInput({ ...base, label: '  ', apartment: '' })).toMatchObject({
      label: null,
      apartment: null,
    })
    expect(() =>
      normalizeAddressInput({ ...base, province: 'Narnia' as unknown as 'CABA' }),
    ).toThrow(TypeError)
  })
})

describe('errores de identidad', () => {
  it('credenciales incorrectas: 401 con los textos del contrato', () => {
    const error = new InvalidCredentialsError()
    expect(error).toBeInstanceOf(DomainError)
    expect(error).toMatchObject({
      code: 'invalid_credentials',
      status: 401,
      title: 'Credenciales incorrectas',
      detail: 'Email o contraseña incorrectos.',
    })
  })

  it('una cuenta deshabilitada responde igual que unas credenciales incorrectas', () => {
    const error = new AccountDisabledError()
    const invalid = new InvalidCredentialsError()
    expect([error.code, error.status, error.title, error.detail]).toEqual([
      invalid.code,
      invalid.status,
      invalid.title,
      invalid.detail,
    ])
  })

  it('bloqueo por intentos: 429 rate_limited con Retry-After', () => {
    const error = new LoginLockedError(120)
    expect(error.retryAfterSeconds).toBe(120)
    expect(error.status).toBe(429)
    expect(error.code).toBe('rate_limited')
    expect(error.detail).toBe(
      'Demasiados intentos fallidos. Esperá unos minutos y volvé a intentar.',
    )
  })

  it('email ya registrado y dirección inexistente', () => {
    expect(new EmailAlreadyRegisteredError()).toMatchObject({
      code: 'email_already_registered',
      status: 409,
      title: 'El email ya tiene una cuenta',
      detail: 'Ya existe una cuenta con ese email. Iniciá sesión o recuperá tu contraseña.',
    })
    expect(new AddressNotFoundError()).toMatchObject({
      code: 'not_found',
      status: 404,
      detail: 'No existe esa dirección en tu libreta.',
    })
  })
})
