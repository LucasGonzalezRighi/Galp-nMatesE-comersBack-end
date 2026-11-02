// DTOs de respuesta de los contenidos, solo para Swagger: reproducen `HomeContent`,
// `AboutContent`, `FaqContent`, `FooterContent`, `ProductTabsContent`, `LegalContent` y sus partes
// con nombre (`SectionHeading`, `StoryScene`, `ProductTabsGroupContent`) del contrato, y el test de
// contrato los compara. Nunca se instancian (los controladores devuelven los read models de
// `application`): los campos van con asignación definida (`!`), como dice el README.

import { ApiProperty, ApiSchema, getSchemaPath } from '@nestjs/swagger'

import {
  ApiSchemaProperty,
  nullableRef,
  type OpenApiSchema,
  SLUG_MAX_LENGTH,
  SLUG_PATTERN,
} from '../../../../shared/infrastructure/http/openapi'

/** Texto con largo máximo. */
function text(maxLength: number): OpenApiSchema {
  return { type: 'string', maxLength }
}

/**
 * Texto o `null`, con largo máximo. Va con `nullable` (y no con `type: ['string', 'null']`) porque
 * es una propiedad de la clase: ver {@link ApiSchemaProperty}.
 */
function nullableText(maxLength: number): OpenApiSchema {
  return { type: 'string', nullable: true, maxLength }
}

/** URL `http(s)` o `null`, como las del contrato (propiedad de la clase: ver `nullableText`). */
const NULLABLE_URL: OpenApiSchema = {
  type: 'string',
  nullable: true,
  format: 'uri',
  maxLength: 2048,
  pattern: '^https?://',
}

/** Slug del contrato. */
const SLUG: OpenApiSchema = {
  type: 'string',
  maxLength: SLUG_MAX_LENGTH,
  pattern: SLUG_PATTERN.source,
}

/** Lista con cantidad mínima y máxima de elementos. */
function list(minItems: number | undefined, maxItems: number, items: OpenApiSchema): OpenApiSchema {
  return { type: 'array', ...(minItems === undefined ? {} : { minItems }), maxItems, items }
}

/** Objeto en línea con todas sus propiedades obligatorias. */
function object(properties: Record<string, OpenApiSchema>): OpenApiSchema {
  return { type: 'object', required: Object.keys(properties), properties }
}

/** Encabezado de una sección del inicio (`SectionHeading`). */
@ApiSchema({ name: 'SectionHeading' })
export class SectionHeadingDto {
  /** Antetítulo. */
  @ApiSchemaProperty(text(60))
  eyebrow!: string

  /** Título. */
  @ApiSchemaProperty(text(60))
  title!: string
}

/** Escena de la historia del inicio (`StoryScene`). */
@ApiSchema({ name: 'StoryScene' })
export class StorySceneDto {
  /** Escena fija del diseño. */
  @ApiSchemaProperty({
    type: 'string',
    enum: ['pieces', 'gourd', 'bombilla', 'yerba', 'ritual', 'leather'],
  })
  key!: string

  /** Antetítulo. */
  @ApiSchemaProperty(text(60))
  eyebrow!: string

  /** Líneas del título (1 a 3). */
  @ApiSchemaProperty(list(1, 3, text(60)))
  titleLines!: string[]

  /** Texto. */
  @ApiSchemaProperty(text(600))
  text!: string

  /** Texto del botón, o `null`. */
  @ApiSchemaProperty(nullableText(40))
  ctaLabel!: string | null
}

/** Textos del inicio (`HomeContent`). */
@ApiSchema({ name: 'HomeContent' })
export class HomeContentDto {
  /** Portada. */
  @ApiSchemaProperty(
    object({
      eyebrow: text(60),
      titleLines: list(1, 3, text(60)),
      text: text(600),
      primaryCtaLabel: text(40),
      secondaryCtaLabel: text(40),
    }),
  )
  hero!: unknown

  /** Las 6 escenas de la historia. */
  @ApiSchemaProperty(list(6, 6, { $ref: getSchemaPath(StorySceneDto) }))
  scenes!: unknown[]

  /** Los 4 pasos del ritual. */
  @ApiSchemaProperty(list(4, 4, text(80)))
  ritualSteps!: string[]

  /** Slugs de los productos de la historia. */
  @ApiSchemaProperty(
    object({
      hero: SLUG,
      bombillas: list(2, 2, SLUG),
      yerbas: list(3, 3, SLUG),
    }),
  )
  storyProducts!: unknown

  /** Encabezado de la colección. */
  @ApiProperty({ type: () => SectionHeadingDto })
  collection!: SectionHeadingDto

  /** Encabezado de los destacados. */
  @ApiProperty({ type: () => SectionHeadingDto })
  featured!: SectionHeadingDto

  /** Encabezado de las reseñas. */
  @ApiProperty({ type: () => SectionHeadingDto })
  reviews!: SectionHeadingDto

  /** Manifiesto. */
  @ApiSchemaProperty(object({ eyebrow: text(60), text: text(400), ctaLabel: text(40) }))
  manifesto!: unknown

  /** Cifras. */
  @ApiSchemaProperty(
    object({
      provinces: { type: 'integer', minimum: 0, maximum: 999 },
      partners: { type: 'integer', minimum: 0, maximum: 999 },
    }),
  )
  stats!: unknown

  /** Bloque del kit. */
  @ApiSchemaProperty(
    object({ eyebrow: text(60), title: text(60), text: text(600), ctaLabel: text(40) }),
  )
  kitBlock!: unknown
}

/** Textos de Nosotros (`AboutContent`). */
@ApiSchema({ name: 'AboutContent' })
export class AboutContentDto {
  /** Portada. */
  @ApiSchemaProperty(
    object({ eyebrow: text(60), titleLines: list(1, 3, text(60)), text: text(600) }),
  )
  hero!: unknown

  /** Socios (hasta 8). */
  @ApiSchemaProperty(
    list(undefined, 8, object({ name: text(60), role: text(80), photo: nullableRef('Image') })),
  )
  partners!: unknown[]

  /** Cita. */
  @ApiSchemaProperty(text(300))
  quote!: string

  /** Antetítulo de los pasos. */
  @ApiSchemaProperty(text(60))
  stepsEyebrow!: string

  /** Los 3 pasos. */
  @ApiSchemaProperty(list(3, 3, object({ title: text(60), text: text(400) })))
  steps!: unknown[]

  /** Texto del botón. */
  @ApiSchemaProperty(text(40))
  ctaLabel!: string
}

/** Preguntas frecuentes (`FaqContent`). */
@ApiSchema({ name: 'FaqContent' })
export class FaqContentDto {
  /** Categorías con sus preguntas. */
  @ApiSchemaProperty(
    list(
      1,
      10,
      object({
        id: SLUG,
        label: text(40),
        items: list(1, 30, object({ question: text(200), answer: text(2000) })),
      }),
    ),
  )
  categories!: unknown[]
}

/** Textos del pie (`FooterContent`). */
@ApiSchema({ name: 'FooterContent' })
export class FooterContentDto {
  /** Lema. */
  @ApiSchemaProperty(text(80))
  tagline!: string

  /** Texto. */
  @ApiSchemaProperty(text(300))
  text!: string

  /** Medios de pago (hasta 10). */
  @ApiSchemaProperty(list(undefined, 10, text(40)))
  paymentMethods!: string[]

  /** Enlace a Defensa del Consumidor, o `null`. */
  @ApiSchemaProperty(NULLABLE_URL)
  consumerDefenseUrl!: string | null
}

/** Textos de fábrica de las pestañas de un grupo (`ProductTabsGroupContent`). */
@ApiSchema({ name: 'ProductTabsGroupContent' })
export class ProductTabsGroupContentDto {
  /** Nota bajo la descripción, o `null`. */
  @ApiSchemaProperty(nullableText(600))
  descriptionNote!: string | null

  /** Título de la pestaña de materiales. */
  @ApiSchemaProperty(text(30))
  materialsTitle!: string

  /** Materiales. */
  @ApiSchemaProperty(text(2000))
  materials!: string

  /** Título de la pestaña de cuidado. */
  @ApiSchemaProperty(text(30))
  careTitle!: string

  /** Cuidado. */
  @ApiSchemaProperty(text(2000))
  care!: string
}

/** Textos de las pestañas de la ficha por grupo (`ProductTabsContent`). */
@ApiSchema({ name: 'ProductTabsContent' })
export class ProductTabsContentDto {
  /** Mates. */
  @ApiProperty({ type: () => ProductTabsGroupContentDto })
  mate!: ProductTabsGroupContentDto

  /** Bombillas. */
  @ApiProperty({ type: () => ProductTabsGroupContentDto })
  bombilla!: ProductTabsGroupContentDto

  /** Yerbas. */
  @ApiProperty({ type: () => ProductTabsGroupContentDto })
  yerba!: ProductTabsGroupContentDto

  /** Envíos, común a todos. */
  @ApiSchemaProperty(text(2000))
  shipping!: string
}

/** Documento legal (`LegalContent`). */
@ApiSchema({ name: 'LegalContent' })
export class LegalContentDto {
  /** Título. */
  @ApiSchemaProperty(text(120))
  title!: string

  /** Fecha de la última actualización (`AAAA-MM-DD`). */
  @ApiSchemaProperty({ type: 'string', format: 'date' })
  updatedAt!: string

  /** Cuerpo en Markdown. */
  @ApiSchemaProperty({ type: 'string', minLength: 1, maxLength: 60_000 })
  body!: string
}
