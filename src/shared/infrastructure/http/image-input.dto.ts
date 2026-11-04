// Foto que manda el dashboard (`ImageInput` del contrato), con las reglas y los mensajes de
// `imageFormSchema` de `@galpon/schemas`. La comparten Nosotros (`partners.N.photo`), los
// productos (`images.N`) y las líneas (`image`). Las reglas de cada campo van en el orden del
// schema de zod: el primer error por campo es el mismo que el del front.

import { applyDecorators } from '@nestjs/common'
import { ApiSchema } from '@nestjs/swagger'
import { Transform, type TransformFnParams } from 'class-transformer'
import { IsInt, IsNotEmpty, IsString, MaxLength, Min, MinLength } from 'class-validator'

import { ApiSchemaProperty } from './openapi'

/** Largo máximo del `publicId`. */
const PUBLIC_ID_MAX_LENGTH = 255

/** Largo mínimo del texto alternativo. */
const ALT_MIN_LENGTH = 3

/** Largo máximo del texto alternativo. */
const ALT_MAX_LENGTH = 120

/** Textos de error de una foto (los de `MESSAGES` del front). */
export const IMAGE_INPUT_MESSAGES = {
  /** `publicId` que falta, no es texto o queda vacío. */
  required: 'Requerido',
  /** `publicId` de más de 255 caracteres. */
  publicIdTooLong: `Máximo ${String(PUBLIC_ID_MAX_LENGTH)} caracteres`,
  /** Ancho o alto que no es un entero mayor a 0. */
  positiveInt: 'Ingresá un número entero mayor a 0',
  /** Texto alternativo que no es texto o no tiene de 3 a 120 caracteres. */
  alt: 'Escribí un texto alternativo de 3 a 120 caracteres',
} as const

/** Valor tal como vino en el JSON, sin la conversión implícita de tipos del pipe global. */
function rawValue({ obj, key }: TransformFnParams): unknown {
  return (obj as Record<string, unknown>)[key]
}

/** Valor crudo recortado; lo que no es texto queda como vino (la validación lo rechaza). */
function trimmed(params: TransformFnParams): unknown {
  const value = rawValue(params)
  return typeof value === 'string' ? value.trim() : value
}

/** Medida en píxeles: un entero mayor a 0, crudo del JSON (`"960"` no pasa). */
function Dimension(): PropertyDecorator {
  const message = IMAGE_INPUT_MESSAGES.positiveInt
  return applyDecorators(
    ApiSchemaProperty({ type: 'integer', minimum: 1 }),
    Transform(rawValue),
    IsInt({ message }),
    Min(1, { message }),
  )
}

/** `publicId`: texto recortado, no vacío y de hasta 255 caracteres (`requiredText(1, 255)`). */
function PublicIdRules(): PropertyDecorator {
  return applyDecorators(
    Transform(trimmed),
    IsString({ message: IMAGE_INPUT_MESSAGES.required }),
    IsNotEmpty({ message: IMAGE_INPUT_MESSAGES.required }),
    MaxLength(PUBLIC_ID_MAX_LENGTH, { message: IMAGE_INPUT_MESSAGES.publicIdTooLong }),
  )
}

/** Texto alternativo: recortado, de 3 a 120 caracteres; todo error dice lo mismo. */
function AltRules(): PropertyDecorator {
  const message = IMAGE_INPUT_MESSAGES.alt
  return applyDecorators(
    Transform(trimmed),
    IsString({ message }),
    MinLength(ALT_MIN_LENGTH, { message }),
    MaxLength(ALT_MAX_LENGTH, { message }),
  )
}

/**
 * Foto ya subida a Cloudinary (`ImageInput`): su `publicId`, las medidas y el texto alternativo.
 * El back arma la `url` desde el `publicId` (ver `resolveImage` de `media`).
 */
@ApiSchema({ name: 'ImageInput' })
export class ImageInputDto {
  /** Identificador de la foto en Cloudinary, de 1 a 255 caracteres (se recorta). */
  @ApiSchemaProperty({ type: 'string', minLength: 1, maxLength: PUBLIC_ID_MAX_LENGTH })
  @PublicIdRules()
  publicId!: string

  /** Ancho en píxeles. */
  @Dimension()
  width!: number

  /** Alto en píxeles. */
  @Dimension()
  height!: number

  /** Texto alternativo, de 3 a 120 caracteres (se recorta). */
  @ApiSchemaProperty({ type: 'string', minLength: ALT_MIN_LENGTH, maxLength: ALT_MAX_LENGTH })
  @AltRules()
  alt!: string
}
