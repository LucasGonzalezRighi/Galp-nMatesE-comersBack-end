// Campos compartidos de los DTOs de identidad: los mensajes y las reglas de
// `../frontend/packages/schemas/src/{messages,fields,account,admin}.ts`, para que el back responda
// con las mismas palabras que la tienda y el dashboard. Cada decorador junta la normalización
// (`@Transform`), la validación (`class-validator`, en el orden de los schemas de zod: el primer
// error por campo es el mismo que el del front) y la propiedad de Swagger.

import { applyDecorators } from '@nestjs/common'
import { ApiProperty } from '@nestjs/swagger'
import { Transform, type TransformFnParams } from 'class-transformer'
import { IsEmail, IsNotEmpty, IsString, Matches, MaxLength, MinLength } from 'class-validator'

import { ApiSchemaProperty, namedRef } from '../../../../shared/infrastructure/http/openapi'

/** Textos de error de los formularios, los mismos que `MESSAGES` del front. */
export const IDENTITY_MESSAGES = {
  /** Campo obligatorio que quedó vacío. */
  required: 'Requerido',
  /** Nombre con menos de 2 letras. */
  minLetters: 'Ingresá al menos 2 letras',
  /** Nombre con algo que no es letra, espacio, apóstrofo o guion. */
  onlyLetters: 'Usá solo letras',
  /** Email con formato inválido. */
  invalidEmail: 'Ingresá un email válido',
  /** Teléfono que no tiene 10 dígitos o empieza con 0. */
  invalidPhone: 'Ingresá el código de área y el número, sin 0 ni 15',
  /** Número de calle que no es de 1 a 5 dígitos ni "S/N". */
  invalidStreetNumber: 'Ingresá el número o S/N',
  /** Código postal fuera del formato argentino. */
  invalidPostalCode: 'Código postal inválido',
  /** Provincia que no es una de las 24 del selector. */
  invalidProvince: 'Elegí una provincia',
  /** Contraseña nueva de menos de 10 caracteres o sin letras y números. */
  weakPassword: 'Mínimo 10 caracteres, con letras y números',
  /** La confirmación no es igual a la contraseña nueva. */
  passwordMismatch: 'Las contraseñas no coinciden',
  /** Campo de texto opcional que llegó con otro tipo (no está en el front: nunca lo manda). */
  invalidText: 'Ingresá un texto',
  /** `isDefault` que no es un booleano de JSON (no está en el front: nunca lo manda). */
  invalidDefault: 'Indicá si es la dirección predeterminada',
} as const

/**
 * Texto de "demasiado largo", como `MESSAGES.max` del front.
 *
 * @param max - Cantidad máxima de caracteres (entero desde 1).
 * @returns `Máximo <max> caracteres`.
 * @throws {RangeError} En español, si `max` no es un entero desde 1.
 */
export function maxMessage(max: number): string {
  if (!Number.isInteger(max) || max < 1) {
    throw new RangeError(`El máximo tiene que ser un entero desde 1 (llegó ${String(max)})`)
  }
  return `Máximo ${String(max)} caracteres`
}

/** Patrón de `PersonName` (letras con acentos y ñ, espacios, apóstrofo y guion), como texto. */
export const PERSON_NAME_PATTERN = "^\\p{L}[\\p{L}\\p{M} '’-]*$"

/** Patrón de `Password` (al menos una letra y un número), como texto. */
export const PASSWORD_PATTERN = '^(?=.*\\p{L})(?=.*[0-9])'

/** Patrón de `Phone`: 10 dígitos sin 0 inicial (la tienda ya lo normaliza). */
export const PHONE_PATTERN = '^[1-9][0-9]{9}$'

/** Patrón del número de calle: de 1 a 5 dígitos o `S/N`. */
export const STREET_NUMBER_PATTERN = '^(?:[0-9]{1,5}|S/N)$'

/** Patrón de `PostalCode`: `1414`, `B1900` o `C1414ABC`. */
export const POSTAL_CODE_PATTERN = '^[A-Za-z]?[0-9]{4}[A-Za-z]{0,3}$'

/** Largo máximo de un email (`Email` del contrato). */
export const EMAIL_MAX_LENGTH = 254

/** Largo máximo de una contraseña. */
export const PASSWORD_MAX_LENGTH = 128

/** Valor tal como vino en el JSON, sin la conversión implícita de tipos del pipe global. */
function rawValue({ obj, key }: TransformFnParams): unknown {
  return (obj as Record<string, unknown>)[key]
}

/**
 * Toma el valor crudo del JSON: `"false"` no pasa a `true` ni `123` a `"123"` (el pipe global
 * convierte tipos por la metadata de TypeScript), así que un tipo equivocado responde 422.
 *
 * @returns El decorador de la propiedad.
 */
export function RawValue(): PropertyDecorator {
  return Transform(rawValue)
}

/**
 * Valor crudo recortado; con `upper`, además en mayúsculas (número de calle y código postal) y,
 * con `lower`, en minúsculas (email). Si no es texto, queda como vino (la validación lo rechaza).
 *
 * @param letterCase - `upper` o `lower` para cambiar las mayúsculas; por defecto, sin cambios.
 * @returns El decorador de la propiedad.
 */
export function Trimmed(letterCase?: 'upper' | 'lower'): PropertyDecorator {
  return Transform((params) => {
    const value = rawValue(params)
    if (typeof value !== 'string') return value
    const trimmed = value.trim()
    if (letterCase === 'upper') return trimmed.toUpperCase()
    if (letterCase === 'lower') return trimmed.toLowerCase()
    return trimmed
  })
}

/**
 * Email obligatorio (`Email`): recortado y en minúsculas, con formato válido y hasta 254
 * caracteres. Todos los errores dicen "Ingresá un email válido".
 *
 * @returns El decorador de la propiedad.
 */
export function EmailField(): PropertyDecorator {
  const message = IDENTITY_MESSAGES.invalidEmail
  return applyDecorators(
    ApiSchemaProperty(namedRef('Email')),
    Trimmed('lower'),
    IsString({ message }),
    MaxLength(EMAIL_MAX_LENGTH, { message }),
    IsEmail({}, { message }),
  )
}

/**
 * Validación de un nombre o apellido (`PersonName`), sin la propiedad de Swagger: recortado, no
 * vacío ("Requerido"), solo letras ("Usá solo letras"), de 2 a 50 caracteres.
 *
 * @returns El decorador de la propiedad.
 */
export function PersonNameRules(): PropertyDecorator {
  const required = IDENTITY_MESSAGES.required
  return applyDecorators(
    Trimmed(),
    IsString({ message: required }),
    IsNotEmpty({ message: required }),
    Matches(new RegExp(PERSON_NAME_PATTERN, 'u'), { message: IDENTITY_MESSAGES.onlyLetters }),
    MinLength(2, { message: IDENTITY_MESSAGES.minLetters }),
    MaxLength(50, { message: maxMessage(50) }),
  )
}

/**
 * Nombre o apellido obligatorio (`PersonName`), con su propiedad de Swagger.
 *
 * @returns El decorador de la propiedad.
 */
export function PersonNameField(): PropertyDecorator {
  return applyDecorators(ApiSchemaProperty(namedRef('PersonName')), PersonNameRules())
}

/**
 * Contraseña nueva (`Password`): de 10 a 128 caracteres, con al menos una letra y un número. No
 * se recorta (los espacios son parte de la contraseña).
 *
 * @returns El decorador de la propiedad.
 */
export function NewPasswordField(): PropertyDecorator {
  const weak = IDENTITY_MESSAGES.weakPassword
  return applyDecorators(
    ApiSchemaProperty(namedRef('Password')),
    RawValue(),
    IsString({ message: weak }),
    MinLength(10, { message: weak }),
    MaxLength(PASSWORD_MAX_LENGTH, { message: maxMessage(PASSWORD_MAX_LENGTH) }),
    Matches(new RegExp(PASSWORD_PATTERN, 'su'), { message: weak }),
  )
}

/**
 * Contraseña de una cuenta existente (inicio de sesión, contraseña actual del admin): solo tiene
 * que estar ("Requerido") y tener hasta 128 caracteres, sin la regla de la contraseña nueva.
 *
 * @returns El decorador de la propiedad.
 */
export function CurrentPasswordField(): PropertyDecorator {
  const required = IDENTITY_MESSAGES.required
  return applyDecorators(
    ApiProperty({ type: 'string', minLength: 1, maxLength: PASSWORD_MAX_LENGTH }),
    RawValue(),
    IsString({ message: required }),
    IsNotEmpty({ message: required }),
    MaxLength(PASSWORD_MAX_LENGTH, { message: maxMessage(PASSWORD_MAX_LENGTH) }),
  )
}
