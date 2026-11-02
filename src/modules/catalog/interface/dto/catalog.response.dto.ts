// DTOs de respuesta del catálogo, solo para Swagger: reproducen `components/schemas` del contrato
// (`Category`, `Rating`, `ProductSummary`, `ProductTabs`, `ProductOptions`, `ProductPage` y
// `ProductDetail`) y el test de contrato los compara. Nunca se instancian (los controladores
// devuelven los read models de `application`): los campos van con asignación definida (`!`),
// como dice el README.

import { ApiProperty, ApiSchema, getSchemaPath } from '@nestjs/swagger'

import {
  ApiSchemaProperty,
  namedRef,
  nullableRef,
  type OpenApiSchema,
  schemaRef,
} from '../../../../shared/infrastructure/http/openapi'
import { PRODUCT_GROUPS } from '../../domain/category.entity'
import { FERRULES, LEATHERS, MAX_QUANTITY_PER_PRODUCT } from '../../domain/product.entity'

/** Grupo de producto como esquema con nombre (`ProductGroup`). */
const PRODUCT_GROUP = { enum: [...PRODUCT_GROUPS], enumName: 'ProductGroup' }

/** Línea del catálogo (`Category`). */
@ApiSchema({ name: 'Category' })
export class CategoryDto {
  /** Id de la línea. */
  @ApiProperty({ type: 'string' })
  id!: string

  /** Slug. */
  @ApiProperty({ type: 'string' })
  slug!: string

  /** Nombre. */
  @ApiProperty({ type: 'string' })
  name!: string

  /** Grupo. */
  @ApiProperty(PRODUCT_GROUP)
  group!: string

  /** Bajada corta. */
  @ApiProperty({ type: 'string' })
  blurb!: string

  /** Foto, o `null`. */
  @ApiSchemaProperty(nullableRef('Image'))
  image!: unknown

  /** Orden en la tienda, desde 1. */
  @ApiProperty({ type: 'integer', minimum: 1 })
  position!: number

  /** Productos publicados de la línea. */
  @ApiProperty({ type: 'integer', minimum: 0 })
  productCount!: number
}

/** Calificación de un producto (`Rating`). */
@ApiSchema({ name: 'Rating' })
export class RatingDto {
  /** Promedio sin redondear, de 0 a 5. */
  @ApiProperty({ type: 'number', minimum: 0, maximum: 5 })
  average!: number

  /** Cantidad de reseñas aprobadas. */
  @ApiProperty({ type: 'integer', minimum: 0 })
  count!: number
}

/** Producto en los listados (`ProductSummary`). */
@ApiSchema({ name: 'ProductSummary' })
export class ProductSummaryDto {
  /** Id. */
  @ApiProperty({ type: 'string' })
  id!: string

  /** Slug actual. */
  @ApiProperty({ type: 'string' })
  slug!: string

  /** Código visible ("N°07"). */
  @ApiProperty({ type: 'string' })
  code!: string

  /** Nombre. */
  @ApiProperty({ type: 'string' })
  name!: string

  /** Descripción. */
  @ApiProperty({ type: 'string' })
  description!: string

  /** Id de la línea. */
  @ApiProperty({ type: 'string' })
  categoryId!: string

  /** Slug de la línea. */
  @ApiProperty({ type: 'string' })
  categorySlug!: string

  /** Nombre de la línea. */
  @ApiProperty({ type: 'string' })
  categoryName!: string

  /** Grupo. */
  @ApiProperty(PRODUCT_GROUP)
  group!: string

  /** Precio final, o `null` si es "a consultar". */
  @ApiSchemaProperty(namedRef('NullablePesos'))
  priceArs!: number | null

  /** Precio sin impuestos nacionales, o `null`. */
  @ApiSchemaProperty(namedRef('NullablePesos'))
  netPriceArs!: number | null

  /** Si se puede agregar al carrito. */
  @ApiProperty({ type: 'boolean' })
  isPurchasable!: boolean

  /** Si no queda stock disponible. */
  @ApiProperty({ type: 'boolean' })
  isSoldOut!: boolean

  /** Máximo de unidades por compra. */
  @ApiProperty({ type: 'integer', minimum: 0, maximum: MAX_QUANTITY_PER_PRODUCT })
  maxQuantity!: number

  /** Si es destacado. */
  @ApiProperty({ type: 'boolean' })
  featured!: boolean

  /** Foto principal, o `null`. */
  @ApiSchemaProperty(nullableRef('Image'))
  mainImage!: unknown

  /** Calificación con las reseñas aprobadas. */
  @ApiProperty({ type: () => RatingDto })
  rating!: RatingDto
}

/** Pestañas de la ficha (`ProductTabs`). */
@ApiSchema({ name: 'ProductTabs' })
export class ProductTabsDto {
  /** Nota bajo la descripción, o `null`. */
  @ApiProperty({ type: 'string', nullable: true })
  descriptionNote!: string | null

  /** Materiales. */
  @ApiProperty({ type: 'string' })
  materials!: string

  /** Envíos. */
  @ApiProperty({ type: 'string' })
  shipping!: string

  /** Cuidado. */
  @ApiProperty({ type: 'string' })
  care!: string
}

/** Cueros y virolas de un mate (`ProductOptions`). */
@ApiSchema({ name: 'ProductOptions' })
export class ProductOptionsDto {
  /** Cueros disponibles. */
  @ApiProperty({ enum: [...LEATHERS], enumName: 'Leather', isArray: true })
  leathers!: string[]

  /** Virolas disponibles. */
  @ApiProperty({ enum: [...FERRULES], enumName: 'Ferrule', isArray: true })
  ferrules!: string[]
}

/** Página de productos (`ProductPage`). */
@ApiSchema({ name: 'ProductPage' })
export class ProductPageDto {
  /** Productos de la página. */
  @ApiProperty({ type: () => ProductSummaryDto, isArray: true })
  items!: ProductSummaryDto[]

  /** Número de página, desde 1. */
  @ApiProperty({ type: 'integer', minimum: 1 })
  page!: number

  /** Productos por página. */
  @ApiProperty({ type: 'integer', minimum: 1, maximum: 100 })
  pageSize!: number

  /** Total de productos que cumplen el filtro. */
  @ApiProperty({ type: 'integer', minimum: 0 })
  total!: number
}

/**
 * Esquemas del catálogo que no salen de una clase: la ficha (`ProductDetail`) es un `allOf` del
 * resumen más sus campos propios, como en el contrato. `buildOpenApiDocument` los suma a
 * `components.schemas`.
 */
export const CATALOG_OPENAPI_SCHEMAS: Readonly<Record<string, OpenApiSchema>> = {
  ProductDetail: {
    allOf: [
      { $ref: getSchemaPath(ProductSummaryDto) },
      {
        type: 'object',
        required: ['images', 'tabs', 'options'],
        properties: {
          images: { type: 'array', items: schemaRef('Image') },
          tabs: { $ref: getSchemaPath(ProductTabsDto) },
          options: nullableRef('ProductOptions'),
        },
      },
    ],
  },
}
