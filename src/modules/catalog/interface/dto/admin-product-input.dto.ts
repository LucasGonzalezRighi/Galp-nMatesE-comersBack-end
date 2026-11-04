// Cuerpo de `POST /admin/products` y `PATCH /admin/products/{id}` (`AdminProductInput` del
// contrato), con las reglas y los mensajes de `productFormSchema` de `@galpon/schemas` más
// `expectedUpdatedAt` del mock. Las reglas de cada campo van en el orden del schema de zod: el
// primer error por campo es el mismo que el del front. Lo que los casos compartidos no cubren dice
// "Requerido" o el mensaje de la lista (Ruling B-79).

import { applyDecorators } from '@nestjs/common'
import { ApiProperty, type ApiPropertyOptions, ApiSchema } from '@nestjs/swagger'
import { Transform, type TransformFnParams, Type } from 'class-transformer'
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateBy,
  ValidateIf,
  ValidateNested,
} from 'class-validator'

import {
  IDENTITY_MESSAGES,
  maxMessage,
  RawValue,
  Trimmed,
} from '../../../identity/interface/dto/identity-fields'
import {
  BooleanField,
  IntField,
  NestedListField,
  SlugField,
  TextField,
} from '../../../content/interface/dto/form-fields'
import { ImageInputDto } from '../../../../shared/infrastructure/http/image-input.dto'
import {
  ApiSchemaProperty,
  nullableRef,
  SLUG_MAX_LENGTH,
  SLUG_PATTERN,
} from '../../../../shared/infrastructure/http/openapi'
import { EachItem, type ItemRule } from '../../../../shared/infrastructure/http/validation.pipe'
import type {
  AdminProductFields,
  EditableProductStatus,
} from '../../application/ports/admin-product.repository.port'
import { isLeather, type Leather, LEATHERS } from '../../domain/product.entity'

/** Estados del formulario (archivar va por `POST /admin/products/{id}/archive`). */
const FORM_PRODUCT_STATUSES = ['draft', 'published'] as const

/** Tope de un precio en pesos (`MAX_PESOS` del front). */
const MAX_PESOS = 99_999_999

/** Máximo de fotos de un producto. */
const MAX_IMAGES = 8

/** Máximo de caracteres de cada pestaña propia. */
const MAX_TAB_TEXT = 2000

/** Largo máximo de `categoryId`. */
const CATEGORY_ID_MAX_LENGTH = 100

/** Textos de error del formulario de productos (los de `MESSAGES` del front). */
export const PRODUCT_INPUT_MESSAGES = {
  /** Obligatorio vacío o de otro tipo. */
  required: IDENTITY_MESSAGES.required,
  /** Precio que no es un entero mayor a 0 ni `null`. */
  invalidPrice: 'Ingresá un precio en pesos mayor a 0, o dejalo a consultar',
  /** Precio mayor a $99.999.999. */
  priceTooHigh: 'El precio no puede superar los $99.999.999',
  /** Estado que no es borrador ni publicado. */
  invalidStatus: 'Elegí un estado',
  /** Más de 8 fotos. */
  maxImages: `Máximo ${String(MAX_IMAGES)} fotos`,
  /** Cuero que no es de la lista. */
  invalidLeather: 'Elegí un cuero de la lista',
  /** Cuero repetido. */
  duplicateLeathers: 'Cada cuero tiene que aparecer una sola vez',
  /** `expectedUpdatedAt` que no es una fecha ISO con zona (el del mock). */
  invalidExpectedUpdatedAt: 'La fecha de la última modificación no es válida.',
} as const

/** Fecha y hora ISO 8601 con zona (`z.iso.datetime({ offset: true })` del mock). */
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/

/**
 * Junta las reglas de un campo en el orden en que se escriben, que es el orden de los errores (los
 * decoradores apilados se aplican de abajo hacia arriba).
 *
 * @param rules - Normalización y validaciones, en el orden del schema del front.
 */
function Validations(...rules: PropertyDecorator[]): PropertyDecorator {
  return applyDecorators(...rules)
}

/**
 * Texto recortado obligatorio de `min` a `max` caracteres (`requiredText(min, max)` del front):
 * vacío → "Requerido", corto → "Mínimo n caracteres", largo → "Máximo n caracteres".
 *
 * @param min - Mínimo de caracteres.
 * @param max - Máximo de caracteres.
 */
function RequiredText(min: number, max: number): PropertyDecorator {
  return applyDecorators(
    Trimmed(),
    IsString({ message: PRODUCT_INPUT_MESSAGES.required }),
    IsNotEmpty({ message: PRODUCT_INPUT_MESSAGES.required }),
    MinLength(min, { message: `Mínimo ${String(min)} caracteres` }),
    MaxLength(max, { message: maxMessage(max) }),
  )
}

/**
 * Cueros del JSON en el orden de `LEATHERS` (el `.transform(normalizeLeathers)` del front) si son
 * todos válidos y sin repetir; si no, quedan como vinieron para que la validación marque el
 * índice o la lista.
 */
function canonicalLeathers({ obj, key }: TransformFnParams): unknown {
  const value: unknown = (obj as Record<string, unknown>)[key]
  if (!Array.isArray(value)) return value
  const items: unknown[] = value
  const valid = items.every((item) => typeof item === 'string' && isLeather(item))
  if (!valid || new Set(items).size !== items.length) return items
  return LEATHERS.filter((leather) => items.includes(leather))
}

/** Cada cuero es uno de `LEATHERS`: si no, "Elegí un cuero de la lista" en su índice. */
const LEATHER_ITEM: ItemRule = {
  name: 'leatherItem',
  code: 'invalid_value',
  message: PRODUCT_INPUT_MESSAGES.invalidLeather,
  isValid: (item) => typeof item === 'string' && isLeather(item),
}

/**
 * Texto de una pestaña propia: recortado, vacío, `null` o ausente = sin texto (el mock acepta que
 * falte); hasta 2000 caracteres.
 */
function OptionalTabText(): PropertyDecorator {
  return applyDecorators(
    ApiProperty({ type: 'string', nullable: true, maxLength: MAX_TAB_TEXT }),
    Transform(({ obj, key }: TransformFnParams): unknown => {
      const value: unknown = (obj as Record<string, unknown>)[key]
      if (typeof value !== 'string') return value ?? null
      const trimmed = value.trim()
      return trimmed === '' ? null : trimmed
    }),
    ValidateIf((_object, value) => value !== null && value !== undefined),
    IsString({ message: PRODUCT_INPUT_MESSAGES.required }),
    MaxLength(MAX_TAB_TEXT, { message: maxMessage(MAX_TAB_TEXT) }),
  )
}

/** Textos propios de las pestañas (`ProductTabsOverride`); cada uno, texto o `null`. */
@ApiSchema({ name: 'ProductTabsOverride' })
export class ProductTabsOverrideDto {
  /** Materiales propio, o `null` para usar el del grupo. */
  @OptionalTabText()
  materials!: string | null

  /** Cuidado propio, o `null` para usar el del grupo. */
  @OptionalTabText()
  care!: string | null
}

/** Cuerpo de `POST /admin/products` y `PATCH /admin/products/{id}` (`AdminProductInput`). */
@ApiSchema({ name: 'AdminProductInput' })
export class AdminProductInputDto {
  /** Nombre, de 3 a 120 caracteres (se recorta). */
  @ApiProperty({
    type: 'string',
    minLength: 3,
    maxLength: 120,
    description: 'Nombre del producto.',
  })
  @RequiredText(3, 120)
  name!: string

  /** Slug: minúsculas, números y guiones, hasta 80. */
  @ApiProperty({
    type: 'string',
    minLength: 1,
    maxLength: SLUG_MAX_LENGTH,
    pattern: SLUG_PATTERN.source,
    description: 'Identificador legible para la dirección web; tiene que ser único.',
  })
  @SlugField()
  slug!: string

  /** Id de la línea, de 1 a 100 caracteres (se recorta). */
  @ApiProperty({
    type: 'string',
    minLength: 1,
    maxLength: CATEGORY_ID_MAX_LENGTH,
    description: 'Identificador de la línea del producto.',
  })
  @TextField(CATEGORY_ID_MAX_LENGTH)
  categoryId!: string

  /** Descripción, de 10 a 2000 caracteres (se recorta). */
  @ApiProperty({ type: 'string', minLength: 10, maxLength: 2000, description: 'Descripción.' })
  @RequiredText(10, 2000)
  description!: string

  /** Precio final en pesos, de 1 a 99.999.999, o `null` ("a consultar"). Crudo del JSON. */
  @ApiProperty({ type: 'integer', nullable: true, minimum: 1, maximum: MAX_PESOS })
  @Validations(
    RawValue(),
    ValidateIf((_object, value) => value !== null),
    IsInt({ message: PRODUCT_INPUT_MESSAGES.invalidPrice }),
    Min(1, { message: PRODUCT_INPUT_MESSAGES.invalidPrice }),
    Max(MAX_PESOS, { message: PRODUCT_INPUT_MESSAGES.priceTooHigh }),
  )
  priceArs!: number | null

  /** Unidades disponibles, de 0 a 9999. */
  @ApiProperty({ type: 'integer', minimum: 0, maximum: 9999, description: 'Unidades en stock.' })
  @IntField(0, 9999)
  stock!: number

  /** Si es destacado. */
  @ApiProperty({ type: 'boolean', description: 'Si es un producto destacado.' })
  @BooleanField()
  featured!: boolean

  /** Borrador o publicado. */
  @ApiProperty({ type: 'string', enum: [...FORM_PRODUCT_STATUSES], description: 'Estado.' })
  @Validations(
    RawValue(),
    IsIn(FORM_PRODUCT_STATUSES, { message: PRODUCT_INPUT_MESSAGES.invalidStatus }),
  )
  status!: EditableProductStatus

  /** Textos propios de las pestañas; ausente o `null` usa los del grupo. */
  @ApiProperty({ ...nullableRef('ProductTabsOverride'), required: false } as ApiPropertyOptions)
  @Validations(
    ValidateIf((_object, value) => value !== null && value !== undefined),
    IsObject({ message: PRODUCT_INPUT_MESSAGES.required }),
    ValidateNested({ message: PRODUCT_INPUT_MESSAGES.required }),
    Type(() => ProductTabsOverrideDto),
  )
  tabsOverride?: ProductTabsOverrideDto | null

  /** Fotos, hasta 8; la primera es la principal. */
  @ApiSchemaProperty({
    type: 'array',
    maxItems: MAX_IMAGES,
    items: { $ref: '#/components/schemas/ImageInput' },
  })
  @NestedListField(
    () => ImageInputDto,
    PRODUCT_INPUT_MESSAGES.required,
    ArrayMaxSize(MAX_IMAGES, { message: PRODUCT_INPUT_MESSAGES.maxImages }),
  )
  images!: ImageInputDto[]

  /** Cueros que ofrece, sin repetir; salen en el orden de `Leather`. */
  @ApiProperty({
    enum: [...LEATHERS],
    enumName: 'Leather',
    isArray: true,
    maxItems: LEATHERS.length,
    uniqueItems: true,
    description: 'Cueros que ofrece el producto, de 0 a 4 y sin repetir.',
  })
  @Validations(
    Transform(canonicalLeathers),
    IsArray({ message: PRODUCT_INPUT_MESSAGES.required }),
    EachItem(LEATHER_ITEM),
    ArrayUnique({ message: PRODUCT_INPUT_MESSAGES.duplicateLeathers }),
  )
  leathers!: Leather[]

  /** `updatedAt` que vio el dashboard al abrir el producto (solo lo usa el `PATCH`). */
  @ApiProperty({ type: 'string', format: 'date-time', required: false })
  @Validations(
    RawValue(),
    ValidateIf((_object, value) => value !== undefined),
    ValidateBy(
      {
        name: 'matches',
        validator: {
          validate: (value) =>
            typeof value === 'string' &&
            ISO_DATE_TIME.test(value) &&
            !Number.isNaN(Date.parse(value)),
        },
      },
      { message: PRODUCT_INPUT_MESSAGES.invalidExpectedUpdatedAt },
    ),
  )
  expectedUpdatedAt?: string

  /**
   * Los datos para los casos de uso.
   *
   * @returns El producto: las pestañas sin ningún texto quedan en `null` (usa las del grupo).
   */
  toFields(): AdminProductFields {
    const materials = this.tabsOverride?.materials ?? null
    const care = this.tabsOverride?.care ?? null
    return {
      name: this.name,
      slug: this.slug,
      categoryId: this.categoryId,
      description: this.description,
      priceArs: this.priceArs,
      stock: this.stock,
      featured: this.featured,
      status: this.status,
      tabsOverride: materials === null && care === null ? null : { materials, care },
      images: this.images.map(({ publicId, width, height, alt }) => ({
        publicId,
        width,
        height,
        alt,
      })),
      leathers: [...this.leathers],
    }
  }
}
