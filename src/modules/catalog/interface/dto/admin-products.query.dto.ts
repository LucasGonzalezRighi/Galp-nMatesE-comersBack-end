// Query de `GET /admin/products`, con los textos y el orden de los errores del `QueryReader` del
// mock (`handlers/admin-products.ts` y `mock/validation.ts`): página, tamaño, estado, stock,
// orden, línea y texto, todos en un solo 422. Un parámetro vacío cuenta como ausente y uno
// repetido toma el primero. No usa `PageQueryDto`: sus textos son los de `GET /products`
// (Ruling B-81).

import { applyDecorators } from '@nestjs/common'
import { ApiPropertyOptional } from '@nestjs/swagger'
import { Transform, type TransformFnParams } from 'class-transformer'
import { IsIn, IsInt, IsOptional, ValidateBy } from 'class-validator'

import {
  INVALID_SLUG_MESSAGE,
  SLUG_MAX_LENGTH,
  SLUG_PATTERN,
} from '../../../../shared/infrastructure/http/openapi'
import {
  DEFAULT_PAGE_SIZE,
  FIRST_PAGE,
  MAX_PAGE_SIZE,
} from '../../../../shared/infrastructure/http/page.dto'
import type { AdminProductQuery } from '../../application/queries/list-admin-products.query'
import { PRODUCT_SORT_ORDERS, type ProductSortOrder } from '../../application/read-models'
import { PRODUCT_STATUSES, type ProductStatus } from '../../domain/product.entity'

/** Largo máximo del texto a buscar. */
const QUERY_MAX_LENGTH = 100

/** Textos de error de la consulta (los del `QueryReader` del mock). */
export const ADMIN_PRODUCTS_QUERY_MESSAGES = {
  pageType: 'La página tiene que ser un número entero.',
  pageMin: 'La página tiene que ser mayor o igual a 1.',
  pageSizeType: 'El tamaño de página tiene que ser un número entero.',
  pageSizeMin: 'El tamaño de página tiene que ser mayor o igual a 1.',
  pageSizeMax: `El tamaño de página no puede pasar de ${String(MAX_PAGE_SIZE)}.`,
  status: `El estado tiene que ser ${PRODUCT_STATUSES.join(', ')}.`,
  stock: 'El stock tiene que ser out.',
  sort: `El orden tiene que ser ${PRODUCT_SORT_ORDERS.join(', ')}.`,
  query: `El texto no puede pasar de ${String(QUERY_MAX_LENGTH)} caracteres.`,
} as const

/** Valores de `stock`. */
const STOCK_FILTERS = ['out'] as const

/** Primer valor del parámetro (como `URLSearchParams.get`); vacío cuenta como ausente. */
function firstValue({ obj, key }: TransformFnParams): unknown {
  const raw: unknown = (obj as Record<string, unknown>)[key]
  const value: unknown = Array.isArray(raw) ? raw[0] : raw
  return value === '' ? undefined : value
}

/**
 * Entero de la query: solo dígitos (con un `-` opcional) y dentro de un entero seguro, como el
 * mock; lo demás queda como texto y `@IsInt` lo rechaza.
 */
function integerValue(params: TransformFnParams): unknown {
  const value = firstValue(params)
  if (typeof value !== 'string' || !/^-?\d+$/.test(value)) return value
  const number = Number(value)
  return Number.isSafeInteger(number) ? number : value
}

/**
 * Cota de un entero que solo se revisa si el valor ya es un número: con `abc` sale solo el error
 * de tipo, como el mock (un error por parámetro). Se llama `min` o `max` para que el pipe le dé
 * el código `too_small` o `too_big`.
 *
 * @param name - `min` o `max`.
 * @param inRange - Si el número cumple la cota.
 * @param message - Texto del error.
 */
function NumberBound(
  name: 'min' | 'max',
  inRange: (value: number) => boolean,
  message: string,
): PropertyDecorator {
  return ValidateBy(
    { name, validator: { validate: (value) => typeof value !== 'number' || inRange(value) } },
    { message },
  )
}

/**
 * Entero opcional con su mínimo y, si hay, su máximo, en el orden del mock (tipo, mínimo, máximo).
 *
 * @param messages - Textos de cada error.
 * @param min - Mínimo.
 * @param max - Máximo, o `undefined`.
 */
function IntegerParam(
  messages: { type: string; min: string; max?: string },
  min: number,
  max?: number,
): PropertyDecorator {
  return applyDecorators(
    Transform(integerValue),
    IsOptional(),
    IsInt({ message: messages.type }),
    NumberBound('min', (value) => value >= min, messages.min),
    ...(max === undefined
      ? []
      : [NumberBound('max', (value) => value <= max, messages.max ?? messages.type)]),
  )
}

/**
 * Parámetro de texto con una sola regla (un error por parámetro, como el mock): el primer valor,
 * vacío = ausente; lo que no es texto tampoco la cumple. El nombre de la regla da el código
 * (`matches` → `invalid_format`, `maxLength` → `too_big`).
 *
 * @param name - Nombre de la regla.
 * @param isValid - Si el texto sirve (el largo se mide como el mock, en unidades de JavaScript).
 * @param message - Texto del error.
 */
function TextParam(
  name: 'matches' | 'maxLength',
  isValid: (value: string) => boolean,
  message: string,
): PropertyDecorator {
  return applyDecorators(
    Transform(firstValue),
    IsOptional(),
    ValidateBy(
      { name, validator: { validate: (value) => typeof value === 'string' && isValid(value) } },
      { message },
    ),
  )
}

/**
 * Parámetro de una lista cerrada: el primer valor, vacío = ausente.
 *
 * @param values - Valores permitidos.
 * @param message - Texto del error.
 */
function OneOfParam(values: readonly string[], message: string): PropertyDecorator {
  return applyDecorators(Transform(firstValue), IsOptional(), IsIn(values, { message }))
}

/** Query de `GET /admin/products` (cualquier otro parámetro responde 422). */
export class AdminProductsQueryDto {
  /** Número de página, desde 1. */
  @ApiPropertyOptional({
    type: 'integer',
    minimum: 1,
    default: FIRST_PAGE,
    description: 'Número de página, empezando en 1.',
  })
  @IntegerParam(
    { type: ADMIN_PRODUCTS_QUERY_MESSAGES.pageType, min: ADMIN_PRODUCTS_QUERY_MESSAGES.pageMin },
    1,
  )
  page?: number

  /** Productos por página, de 1 a 100. */
  @ApiPropertyOptional({
    type: 'integer',
    minimum: 1,
    maximum: MAX_PAGE_SIZE,
    default: DEFAULT_PAGE_SIZE,
    description: 'Cantidad de elementos por página (de 1 a 100).',
  })
  @IntegerParam(
    {
      type: ADMIN_PRODUCTS_QUERY_MESSAGES.pageSizeType,
      min: ADMIN_PRODUCTS_QUERY_MESSAGES.pageSizeMin,
      max: ADMIN_PRODUCTS_QUERY_MESSAGES.pageSizeMax,
    },
    1,
    MAX_PAGE_SIZE,
  )
  pageSize?: number

  /** Estado del producto. */
  @ApiPropertyOptional({
    enum: [...PRODUCT_STATUSES],
    enumName: 'ProductStatus',
    description: 'Estado del producto; deja solo los que están en ese estado.',
  })
  @OneOfParam(PRODUCT_STATUSES, ADMIN_PRODUCTS_QUERY_MESSAGES.status)
  status?: ProductStatus

  /** Con `out`, solo los productos sin unidades disponibles. */
  @ApiPropertyOptional({
    type: 'string',
    enum: [...STOCK_FILTERS],
    description: 'Con `out`, deja solo los productos sin stock.',
  })
  @OneOfParam(STOCK_FILTERS, ADMIN_PRODUCTS_QUERY_MESSAGES.stock)
  stock?: 'out'

  /** Orden de los resultados; sin él, por código. */
  @ApiPropertyOptional({
    enum: [...PRODUCT_SORT_ORDERS],
    enumName: 'ProductSortOrder',
    description: 'Orden de los resultados. Si falta, van por código (`sequence`).',
  })
  @OneOfParam(PRODUCT_SORT_ORDERS, ADMIN_PRODUCTS_QUERY_MESSAGES.sort)
  sort?: ProductSortOrder

  /** Slug de la línea. */
  @ApiPropertyOptional({
    type: 'string',
    maxLength: SLUG_MAX_LENGTH,
    pattern: SLUG_PATTERN.source,
    description: 'Slug de la línea; deja solo los productos de esa línea.',
  })
  @TextParam(
    'matches',
    (value) => value.length <= SLUG_MAX_LENGTH && SLUG_PATTERN.test(value),
    INVALID_SLUG_MESSAGE,
  )
  category?: string

  /** Texto a buscar en el nombre y el código. */
  @ApiPropertyOptional({
    type: 'string',
    maxLength: QUERY_MAX_LENGTH,
    description:
      'Texto a buscar. Se compara sin acentos ni mayúsculas sobre el nombre y el código del producto.',
  })
  @TextParam(
    'maxLength',
    (value) => value.length <= QUERY_MAX_LENGTH,
    ADMIN_PRODUCTS_QUERY_MESSAGES.query,
  )
  q?: string

  /**
   * La consulta de la aplicación con los valores ya validados.
   *
   * @returns La consulta, con la página 1 y 24 por página por defecto.
   */
  toQuery(): AdminProductQuery {
    return {
      q: this.q,
      category: this.category,
      status: this.status,
      stock: this.stock,
      sort: this.sort,
      page: this.page ?? FIRST_PAGE,
      pageSize: this.pageSize ?? DEFAULT_PAGE_SIZE,
    }
  }
}
