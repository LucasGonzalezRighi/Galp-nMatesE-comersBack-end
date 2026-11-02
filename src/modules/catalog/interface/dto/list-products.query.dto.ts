import { ApiPropertyOptional } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator'

import {
  INVALID_SLUG_MESSAGE,
  SLUG_MAX_LENGTH,
  SLUG_PATTERN,
} from '../../../../shared/infrastructure/http/openapi'
import { PageQueryDto } from '../../../../shared/infrastructure/http/page.dto'
import type { ProductFilter } from '../../application/ports/product.repository.port'
import { PRODUCT_SORT_ORDERS, type ProductSortOrder } from '../../application/read-models'
import { PRODUCT_GROUPS, type ProductGroup } from '../../domain/category.entity'

/** Orden por defecto del listado (contrato). */
export const DEFAULT_PRODUCT_SORT: ProductSortOrder = 'destacados'

/**
 * Lee un booleano de la query escrito como `true` o `false`. Mira el valor original del pedido,
 * porque la conversión implícita del pipe ya convirtió `"false"` en `true`; cualquier otro texto
 * queda como está y lo rechaza `@IsBoolean` (422).
 *
 * @param raw - Valor crudo del parámetro.
 * @returns `true`, `false` o el valor sin tocar.
 */
export function parseQueryBoolean(raw: unknown): unknown {
  if (raw === 'true') return true
  if (raw === 'false') return false
  return raw
}

/**
 * Query de `GET /products`: los filtros del contrato (`category`, `group`, `ids`, `q`, `sort`,
 * `featured`) más `page` y `pageSize`. Cualquier otro parámetro responde 422 (el pipe global
 * rechaza campos que no están en el DTO).
 */
export class ListProductsQueryDto extends PageQueryDto {
  /** Slug de la línea. */
  @ApiPropertyOptional({
    type: 'string',
    maxLength: SLUG_MAX_LENGTH,
    pattern: SLUG_PATTERN.source,
    description: 'Slug de la línea; deja solo los productos de esa línea.',
  })
  @IsOptional()
  @IsString({ message: INVALID_SLUG_MESSAGE })
  @MaxLength(SLUG_MAX_LENGTH, { message: INVALID_SLUG_MESSAGE })
  @Matches(SLUG_PATTERN, { message: INVALID_SLUG_MESSAGE })
  category?: string

  /** Grupo de producto. */
  @ApiPropertyOptional({
    enum: [...PRODUCT_GROUPS],
    enumName: 'ProductGroup',
    description: 'Grupo de producto; deja solo los productos de ese grupo.',
  })
  @IsOptional()
  @IsIn(PRODUCT_GROUPS, { message: `El grupo tiene que ser ${PRODUCT_GROUPS.join(', ')}.` })
  group?: ProductGroup

  /** Ids de producto separados por coma. */
  @ApiPropertyOptional({
    type: 'string',
    minLength: 1,
    maxLength: 4000,
    description: 'Ids de producto separados por coma; deja solo esos productos.',
  })
  @IsOptional()
  @IsString({ message: 'Los ids tienen que ser un texto.' })
  @MinLength(1, { message: 'Los ids no pueden estar vacíos.' })
  @MaxLength(4000, { message: 'Los ids no pueden pasar de 4000 caracteres.' })
  ids?: string

  /** Texto a buscar. */
  @ApiPropertyOptional({
    type: 'string',
    maxLength: 100,
    description: 'Texto a buscar en el nombre, la descripción y la línea del producto.',
  })
  @IsOptional()
  @IsString({ message: 'La búsqueda tiene que ser un texto.' })
  @MaxLength(100, { message: 'La búsqueda no puede pasar de 100 caracteres.' })
  q?: string

  /** Orden de los resultados. */
  @ApiPropertyOptional({
    enum: [...PRODUCT_SORT_ORDERS],
    enumName: 'ProductSortOrder',
    default: DEFAULT_PRODUCT_SORT,
    description: 'Orden de los resultados.',
  })
  @IsOptional()
  @IsIn(PRODUCT_SORT_ORDERS, {
    message: `El orden tiene que ser ${PRODUCT_SORT_ORDERS.join(', ')}.`,
  })
  sort?: ProductSortOrder

  /** Con `true`, solo los destacados. */
  @ApiPropertyOptional({
    type: 'boolean',
    description: 'Con `true`, deja solo los productos destacados.',
  })
  @IsOptional()
  @Transform(({ obj, key }: { obj: Record<string, unknown>; key: string }) =>
    parseQueryBoolean(obj[key]),
  )
  @IsBoolean({ message: 'El valor de featured tiene que ser true o false.' })
  featured?: boolean

  /**
   * Arma el filtro de la query de aplicación con los valores ya validados.
   *
   * @returns El filtro de `ListProductsQuery` (orden por defecto `destacados`; `ids` separados
   *   por coma).
   */
  toFilter(): ProductFilter {
    return {
      category: this.category,
      group: this.group,
      ids: this.ids?.split(','),
      q: this.q,
      sort: this.sort ?? DEFAULT_PRODUCT_SORT,
      featured: this.featured,
      page: this.page,
      pageSize: this.pageSize,
    }
  }
}
