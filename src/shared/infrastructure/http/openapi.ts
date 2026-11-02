import { applyDecorators } from '@nestjs/common'
import {
  ApiProperty,
  type ApiPropertyOptions,
  ApiResponse,
  ApiSchema,
  type ReferenceObject,
  type SchemaObject,
} from '@nestjs/swagger'

import { PROBLEM_CONTENT_TYPE } from './problem.filter'

/** Patrón de los slugs del contrato (`mate-imperial-premium`). */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Largo máximo de un slug en el contrato. */
export const SLUG_MAX_LENGTH = 80

/** Mensaje en español de un slug inválido (el mismo que el mock del front). */
export const INVALID_SLUG_MESSAGE =
  'El slug solo puede tener minúsculas, números y guiones, y hasta 80 caracteres.'

/** Esquema de OpenAPI (objeto o referencia), como lo tipa `@nestjs/swagger`. */
export type OpenApiSchema = SchemaObject | ReferenceObject

/**
 * Referencia a un esquema de `components.schemas` por su nombre en el contrato.
 *
 * @param name - Nombre del esquema (`Image`, `NullablePesos`…).
 * @returns El `$ref` local.
 * @throws {TypeError} En español, si el nombre está vacío.
 */
export function schemaRef(name: string): ReferenceObject {
  if (name.trim() === '') throw new TypeError('El nombre del esquema no puede estar vacío.')
  return { $ref: `#/components/schemas/${name}` }
}

/**
 * Propiedad que apunta a un esquema con nombre (`priceArs` → `NullablePesos`). Va envuelta en un
 * `allOf` de un elemento porque, con un `$ref` suelto, `@ApiProperty` le suma el `type` que
 * refleja TypeScript (`object`); el test de contrato lo aplana a la misma referencia.
 *
 * @param name - Nombre del esquema referenciado.
 * @returns El esquema `allOf: [$ref]`.
 * @throws {TypeError} En español, si el nombre está vacío.
 */
export function namedRef(name: string): SchemaObject {
  return { allOf: [schemaRef(name)] }
}

/**
 * Referencia que admite `null`, con la forma del contrato (`oneOf: [$ref, { type: 'null' }]`).
 *
 * @param name - Nombre del esquema referenciado.
 * @returns El esquema `oneOf`.
 * @throws {TypeError} En español, si el nombre está vacío.
 */
export function nullableRef(name: string): SchemaObject {
  return { oneOf: [schemaRef(name), { type: 'null' }] }
}

/**
 * `@ApiProperty` obligatorio con un esquema de OpenAPI escrito tal cual: objetos en línea (con su
 * `required`), `type: ['string', 'null']` anidados, `allOf` y `oneOf`. Los tipos de
 * `@nestjs/swagger` describen `properties` con su propia metadata y no aceptan esos esquemas,
 * aunque en ejecución pasan sin cambios (lo comprueba el test de contrato): por eso la única
 * conversión de tipos está acá. `selfRequired` hace que la propiedad quede en el `required` de la
 * clase aunque el esquema traiga su propio `required` (un objeto en línea).
 *
 * @param schema - Esquema de la propiedad. En la raíz, un `null` posible va con `nullable: true`
 *   (`@ApiProperty` lo pasa a la forma de OpenAPI 3.1); dentro de `properties`, con
 *   `type: ['string', 'null']`.
 * @returns El decorador de la propiedad.
 */
export function ApiSchemaProperty(schema: OpenApiSchema): PropertyDecorator {
  return ApiProperty({ ...schema, selfRequired: true } as ApiPropertyOptions)
}

/** Título de cada respuesta de error que declaran los controladores, como en el contrato. */
const PROBLEM_DESCRIPTIONS: Readonly<Record<number, string>> = {
  404: 'El recurso no existe o no está publicado.',
  422: 'Los datos enviados no son válidos. `errors` detalla cada campo.',
  429: 'Demasiadas solicitudes. `Retry-After` dice en cuántos segundos reintentar.',
  500: 'Error inesperado del servidor.',
}

/**
 * Declara en Swagger las respuestas de error (`application/problem+json` con el esquema
 * `Problem`) de una operación.
 *
 * @param statuses - Códigos HTTP de error que la operación documenta (404, 422, 429, 500).
 * @returns El decorador combinado.
 * @throws {RangeError} En español, si algún código no es de error o no tiene descripción.
 */
export function ApiProblemResponses(...statuses: readonly number[]): MethodDecorator {
  return applyDecorators(
    ...statuses.map((status) => {
      const description = PROBLEM_DESCRIPTIONS[status]
      if (description === undefined) {
        throw new RangeError(`No hay una respuesta de error documentada para ${String(status)}.`)
      }
      return ApiResponse({
        status,
        description,
        content: { [PROBLEM_CONTENT_TYPE]: { schema: schemaRef('Problem') } },
      })
    }),
  )
}

/** Foto del contrato (`Image`), compartida por el catálogo y los contenidos. */
@ApiSchema({ name: 'Image' })
export class ImageDto {
  /** Identificador estable de la foto. */
  @ApiProperty({ type: 'string' })
  publicId!: string

  /** URL que sirve la tienda. */
  @ApiProperty({ type: 'string' })
  url!: string

  /** Ancho en píxeles. */
  @ApiProperty({ type: 'integer', minimum: 1 })
  width!: number

  /** Alto en píxeles. */
  @ApiProperty({ type: 'integer', minimum: 1 })
  height!: number

  /** Texto alternativo. */
  @ApiProperty({ type: 'string' })
  alt!: string
}

/**
 * Esquemas compartidos del contrato que no salen de una clase: montos con nombre (`Pesos`,
 * `NullablePesos`) y el error `Problem` con sus partes. `buildOpenApiDocument` los suma a
 * `components.schemas`.
 */
export const SHARED_OPENAPI_SCHEMAS: Readonly<Record<string, OpenApiSchema>> = {
  Pesos: { type: 'integer', minimum: 0, maximum: 99_999_999 },
  NullablePesos: { type: ['integer', 'null'], minimum: 0, maximum: 99_999_999 },
  Problem: {
    type: 'object',
    required: ['type', 'title', 'status'],
    properties: {
      type: { type: 'string' },
      title: { type: 'string' },
      status: { type: 'integer', minimum: 400, maximum: 599 },
      detail: { type: 'string' },
      instance: { type: 'string' },
      errors: { type: 'array', items: schemaRef('FieldError') },
      changes: { type: 'array', items: schemaRef('ChangeNotice') },
    },
  },
  FieldError: {
    type: 'object',
    required: ['field', 'code', 'message'],
    properties: {
      field: { type: 'string' },
      code: { type: 'string' },
      message: { type: 'string' },
    },
  },
  ChangeNotice: {
    type: 'object',
    required: ['kind', 'productId', 'message'],
    properties: {
      kind: { type: 'string', enum: ['price', 'stock', 'discount', 'shipping', 'unavailable'] },
      productId: { type: ['string', 'null'] },
      message: { type: 'string' },
    },
  },
}
