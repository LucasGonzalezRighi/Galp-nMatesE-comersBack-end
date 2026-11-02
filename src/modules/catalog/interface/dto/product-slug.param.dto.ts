import { ApiProperty } from '@nestjs/swagger'
import { IsString, Matches, MaxLength, MinLength } from 'class-validator'

import {
  INVALID_SLUG_MESSAGE,
  SLUG_MAX_LENGTH,
  SLUG_PATTERN,
} from '../../../../shared/infrastructure/http/openapi'

/** Detalle del 404 de un producto que no existe o no está publicado (el mismo que el mock). */
export const PRODUCT_NOT_FOUND = 'No existe un producto con ese slug.'

/**
 * Slug de producto de la ruta (parámetro `ProductSlug` del contrato): minúsculas, números y
 * guiones, hasta 80 caracteres. Admite también un slug anterior del producto. Si no tiene el
 * formato, el pipe global responde 422 con `errors[0].field = 'slug'`.
 */
export class ProductSlugParamDto {
  /** Slug actual o anterior del producto. */
  @ApiProperty({
    type: 'string',
    minLength: 1,
    maxLength: SLUG_MAX_LENGTH,
    pattern: SLUG_PATTERN.source,
    description: 'Slug del producto. Admite también un slug anterior del mismo producto.',
  })
  @IsString({ message: INVALID_SLUG_MESSAGE })
  @MinLength(1, { message: INVALID_SLUG_MESSAGE })
  @MaxLength(SLUG_MAX_LENGTH, { message: INVALID_SLUG_MESSAGE })
  @Matches(SLUG_PATTERN, { message: INVALID_SLUG_MESSAGE })
  slug = ''
}
