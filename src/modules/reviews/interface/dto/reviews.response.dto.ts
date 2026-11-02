// DTOs de respuesta de reseñas, solo para Swagger: reproducen `Review`, `ReviewStats`,
// `ReviewPage` y `FeaturedReview` del contrato, y el test de contrato los compara. Nunca se
// instancian (los controladores devuelven los read models de `application`): los campos van con
// asignación definida (`!`), como dice el README.

import { ApiProperty, ApiSchema, getSchemaPath } from '@nestjs/swagger'

import type { OpenApiSchema } from '../../../../shared/infrastructure/http/openapi'

/** Reseña publicada (`Review`). */
@ApiSchema({ name: 'Review' })
export class ReviewDto {
  /** Id. */
  @ApiProperty({ type: 'string' })
  id!: string

  /** Nombre de quien la escribió ("Anónimo" si no lo dio). */
  @ApiProperty({ type: 'string' })
  authorName!: string

  /** Puntaje de 1 a 5, de a media estrella. */
  @ApiProperty({ type: 'number', multipleOf: 0.5, minimum: 1, maximum: 5 })
  rating!: number

  /** Texto. */
  @ApiProperty({ type: 'string' })
  text!: string

  /** Fecha de creación, ISO 8601. */
  @ApiProperty({ type: 'string', format: 'date-time' })
  createdAt!: string

  /** Si quien la escribió compró el producto. */
  @ApiProperty({ type: 'boolean' })
  verifiedPurchase!: boolean
}

/** Promedio y distribución de las reseñas aprobadas de un producto (`ReviewStats`). */
@ApiSchema({ name: 'ReviewStats' })
export class ReviewStatsDto {
  /** Promedio sin redondear; 0 si no hay reseñas. */
  @ApiProperty({ type: 'number', minimum: 0, maximum: 5 })
  average!: number

  /** Cantidad de reseñas aprobadas. */
  @ApiProperty({ type: 'integer', minimum: 0 })
  count!: number

  /** Una fila por estrella (5 a 1), con cantidad y porcentaje. */
  @ApiProperty({
    type: 'array',
    items: {
      type: 'object',
      required: ['stars', 'count', 'percent'],
      properties: {
        stars: { type: 'integer', minimum: 1, maximum: 5 },
        count: { type: 'integer', minimum: 0 },
        percent: { type: 'integer', minimum: 0, maximum: 100 },
      },
    },
  })
  distribution!: unknown[]
}

/** Página de reseñas con sus estadísticas (`ReviewPage`). */
@ApiSchema({ name: 'ReviewPage' })
export class ReviewPageDto {
  /** Reseñas de la página, de la más nueva a la más vieja. */
  @ApiProperty({ type: () => ReviewDto, isArray: true })
  items!: ReviewDto[]

  /** Número de página, desde 1. */
  @ApiProperty({ type: 'integer', minimum: 1 })
  page!: number

  /** Reseñas por página. */
  @ApiProperty({ type: 'integer', minimum: 1, maximum: 100 })
  pageSize!: number

  /** Total de reseñas aprobadas. */
  @ApiProperty({ type: 'integer', minimum: 0 })
  total!: number

  /** Promedio y distribución de todas las aprobadas. */
  @ApiProperty({ type: () => ReviewStatsDto })
  stats!: ReviewStatsDto
}

/**
 * Esquemas de reseñas que no salen de una clase: la destacada (`FeaturedReview`) es un `allOf`
 * de la reseña más su producto, como en el contrato. `buildOpenApiDocument` los suma a
 * `components.schemas`.
 */
export const REVIEWS_OPENAPI_SCHEMAS: Readonly<Record<string, OpenApiSchema>> = {
  FeaturedReview: {
    allOf: [
      { $ref: getSchemaPath(ReviewDto) },
      {
        type: 'object',
        required: ['product'],
        properties: {
          product: {
            type: 'object',
            required: ['slug', 'name'],
            properties: { slug: { type: 'string' }, name: { type: 'string' } },
          },
        },
      },
    ],
  },
}
