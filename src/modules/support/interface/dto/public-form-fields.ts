// Campos compartidos de los formularios públicos (contacto, arrepentimiento y reseña): los
// mensajes y las reglas de `../frontend/packages/schemas/src/{messages,fields}.ts`, con la forma
// estricta del contrato (los campos `nullable` tienen que venir, en `null` si no hay dato).

import { applyDecorators } from '@nestjs/common'
import { Transform, type TransformFnParams } from 'class-transformer'
import { IsDefined, IsString, Matches, MaxLength, ValidateIf } from 'class-validator'

import {
  ApiSchemaProperty,
  namedRef,
  nullableRef,
  type OpenApiSchema,
} from '../../../../shared/infrastructure/http/openapi'
import { RawValue } from '../../../identity/interface/dto/identity-fields'
import { ORDER_NUMBER_PATTERN } from '../../../orders/domain/order-number'

/** Textos de error de los formularios públicos, los mismos que `MESSAGES` del front. */
export const PUBLIC_FORM_MESSAGES = {
  /** Campo obligatorio que no vino (lo que los casos compartidos no cubren, Ruling B-79). */
  required: 'Requerido',
  /** Nombre del contacto vacío o de menos de 2 caracteres. */
  contactName: 'Contanos tu nombre',
  /** Mensaje del contacto de menos de 10 caracteres. */
  contactMessage: 'Escribí al menos 10 caracteres',
  /** Motivo que no es uno de la lista. */
  invalidContactReason: 'Elegí un motivo',
  /** Número de pedido que no es `GLP-` y cinco dígitos. */
  invalidOrderNumber: 'El número tiene el formato GLP-12345',
  /** Campo trampa que no es texto o es demasiado largo (con texto igual se descarta en silencio). */
  honeypot: 'Este campo tiene que quedar vacío.',
} as const

/** Largo máximo que se acepta en el campo trampa (como `POST /orders`). */
const HONEYPOT_MAX_LENGTH = 200

/** El campo no es `null`: si es `null`, el resto de las reglas no corre. */
const notNull = (_object: object, value: unknown): boolean => value !== null

/**
 * Texto recortado; vacío (o solo espacios) queda en `null`. Si no es texto, queda como vino (la
 * validación lo rechaza).
 */
function trimmedOrNull({ obj, key }: TransformFnParams): unknown {
  const value: unknown = (obj as Record<string, unknown>)[key]
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/**
 * Campo de texto obligatorio que admite `null`: tiene que venir ("Requerido" si falta); `null`
 * pasa sin más reglas.
 *
 * @param schema - Esquema de Swagger de la propiedad.
 * @param rules - Reglas del valor cuando no es `null`.
 * @returns El decorador de la propiedad.
 */
function NullableRequired(schema: OpenApiSchema, ...rules: PropertyDecorator[]): PropertyDecorator {
  return applyDecorators(
    ApiSchemaProperty(schema),
    ValidateIf(notNull),
    IsDefined({ message: PUBLIC_FORM_MESSAGES.required }),
    ...rules,
  )
}

/**
 * Campo trampa (`Honeypot`): tiene que venir; `null`, `''` o un texto (que el caso de uso descarta
 * en silencio). Llega crudo, sin recortar: un espacio también es un bot.
 *
 * @returns El decorador de la propiedad.
 */
export function HoneypotField(): PropertyDecorator {
  const message = PUBLIC_FORM_MESSAGES.honeypot
  return NullableRequired(
    namedRef('Honeypot'),
    RawValue(),
    IsString({ message }),
    MaxLength(HONEYPOT_MAX_LENGTH, { message }),
  )
}

/**
 * Número de pedido opcional (`OrderNumber` o `null`): se recorta y pasa a mayúsculas; vacío queda
 * en `null`. Si viene, `GLP-` y cinco dígitos.
 *
 * @returns El decorador de la propiedad.
 */
export function NullableOrderNumberField(): PropertyDecorator {
  const message = PUBLIC_FORM_MESSAGES.invalidOrderNumber
  return NullableRequired(
    nullableRef('OrderNumber'),
    Transform((params) => {
      const value = trimmedOrNull(params)
      return typeof value === 'string' ? value.toUpperCase() : value
    }),
    IsString({ message }),
    Matches(ORDER_NUMBER_PATTERN, { message }),
  )
}

/**
 * Texto opcional (`string` o `null`) de hasta `max` caracteres: se recorta y vacío queda en
 * `null` ("Máximo N caracteres" si se pasa).
 *
 * @param max - Largo máximo, entero desde 1.
 * @param tooLong - Mensaje si se pasa del máximo.
 * @returns El decorador de la propiedad.
 */
export function NullableTextField(max: number, tooLong: string): PropertyDecorator {
  return NullableRequired(
    { type: 'string', nullable: true, maxLength: max },
    Transform(trimmedOrNull),
    IsString({ message: PUBLIC_FORM_MESSAGES.required }),
    MaxLength(max, { message: tooLong }),
  )
}
