// Cuerpos de los guardados de contenidos del dashboard (`PUT /admin/content/*`), con las reglas y
// los mensajes de los `*ContentFormSchema` de `@galpon/schemas` (los helpers de `form-fields.ts`).
// No llevan `@ApiSchema`: el cuerpo de cada `PUT` es el mismo esquema que la respuesta y lo
// documenta el controlador con `schemaRef`; el de Nosotros (`AboutContentInput`) está en
// `content.response.dto.ts`.

import { applyDecorators } from '@nestjs/common'
import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  IsDefined,
  IsIn,
  IsObject,
  ValidateBy,
  ValidateIf,
  ValidateNested,
} from 'class-validator'

import { ImageInputDto } from '../../../../shared/infrastructure/http/image-input.dto'
import type {
  AboutContentInput,
  PartnerPhotoInput,
} from '../../application/commands/update-about-content.command'
import type {
  FaqContent,
  FooterContent,
  HomeContent,
  LegalContent,
  ProductTabsContent,
  ProductTabsGroupContent,
  SectionHeading,
  StoryScene,
} from '../../application/read-models'
import {
  CalendarDateField,
  ExactItems,
  exactItemsMessage,
  FORM_MESSAGES,
  IntField,
  ItemsBetween,
  itemsBetweenMessage,
  maxItemsMessage,
  NestedField,
  NestedListField,
  NullableTextField,
  SlugField,
  SlugListField,
  TextField,
  TextListField,
} from './form-fields'
import { unknownLegalMarkerMessage, unknownLegalMarkers } from '../../domain/legal-markers'

/** Escenas del recorrido del inicio, una vez cada una. */
const STORY_SCENE_KEYS = ['pieces', 'gourd', 'bombilla', 'yerba', 'ritual', 'leather'] as const

/** Líneas de un título (`titleLines`): de 1 a 3 textos de hasta 60 caracteres. */
function TitleLinesField(): PropertyDecorator {
  return TextListField(60, itemsBetweenMessage(1, 3, 'líneas'), ItemsBetween(1, 3, 'líneas'))
}

/** Las escenas no se repiten: si no, "Cada escena tiene que aparecer una sola vez" en `scenes`. */
function UniqueScenes(): PropertyDecorator {
  return ValidateBy(
    {
      name: 'uniqueScenes',
      validator: {
        validate: (value: unknown) => {
          if (!Array.isArray(value)) return true
          const keys = value.map((scene: unknown): unknown =>
            typeof scene === 'object' && scene !== null ? Reflect.get(scene, 'key') : scene,
          )
          return new Set(keys).size === keys.length
        },
      },
    },
    { message: FORM_MESSAGES.duplicateScenes },
  )
}

/** Foto de un socio: un `ImageInput` o `null`; si falta o no es un objeto, "Requerido". */
function NullableImageField(): PropertyDecorator {
  const message = FORM_MESSAGES.required
  return applyDecorators(
    ValidateIf((_object, value) => value !== null),
    IsDefined({ message }),
    IsObject({ message }),
    ValidateNested({ message }),
    Type(() => ImageInputDto),
  )
}

/** Antetítulo y título de una sección (`SectionHeading`). */
export class SectionHeadingInputDto implements SectionHeading {
  /** Antetítulo, hasta 60 caracteres. */
  @TextField(60)
  eyebrow!: string

  /** Título, hasta 60 caracteres. */
  @TextField(60)
  title!: string
}

/** Portada del inicio. */
export class HomeHeroInputDto {
  /** Antetítulo. */
  @TextField(60)
  eyebrow!: string

  /** Líneas del título (1 a 3). */
  @TitleLinesField()
  titleLines!: string[]

  /** Texto, hasta 600 caracteres. */
  @TextField(600)
  text!: string

  /** Botón principal. */
  @TextField(40)
  primaryCtaLabel!: string

  /** Botón secundario. */
  @TextField(40)
  secondaryCtaLabel!: string
}

/** Escena del recorrido (`StoryScene`). */
export class StorySceneInputDto implements StoryScene {
  /** Escena fija del diseño. */
  @IsIn(STORY_SCENE_KEYS, { message: FORM_MESSAGES.required })
  key!: StoryScene['key']

  /** Antetítulo. */
  @TextField(60)
  eyebrow!: string

  /** Líneas del título (1 a 3). */
  @TitleLinesField()
  titleLines!: string[]

  /** Texto, hasta 600 caracteres. */
  @TextField(600)
  text!: string

  /** Texto del botón; vacío queda en `null` (sin botón). */
  @NullableTextField(40)
  ctaLabel!: string | null
}

/** Slugs de los productos del recorrido. */
export class StoryProductsInputDto {
  /** Producto de la portada. */
  @SlugField()
  hero!: string

  /** Las dos bombillas. */
  @SlugListField(2, 'bombillas')
  bombillas!: string[]

  /** Las tres yerbas. */
  @SlugListField(3, 'yerbas')
  yerbas!: string[]
}

/** Manifiesto del inicio. */
export class ManifestoInputDto {
  /** Antetítulo. */
  @TextField(60)
  eyebrow!: string

  /** Texto, hasta 400 caracteres. */
  @TextField(400)
  text!: string

  /** Texto del botón. */
  @TextField(40)
  ctaLabel!: string
}

/** Números del galpón (enteros de 0 a 999). */
export class StatsInputDto {
  /** Provincias a las que se envió. */
  @IntField(0, 999)
  provinces!: number

  /** Socios del galpón. */
  @IntField(0, 999)
  partners!: number
}

/** Bloque del kit del inicio. */
export class KitBlockInputDto {
  /** Antetítulo. */
  @TextField(60)
  eyebrow!: string

  /** Título. */
  @TextField(60)
  title!: string

  /** Texto, hasta 600 caracteres. */
  @TextField(600)
  text!: string

  /** Texto del botón. */
  @TextField(40)
  ctaLabel!: string
}

/** Cuerpo de `PUT /admin/content/home` (`homeContentFormSchema`). */
export class HomeContentInputDto implements HomeContent {
  /** Portada. */
  @NestedField(() => HomeHeroInputDto)
  hero!: HomeHeroInputDto

  /** Las seis escenas, una de cada una. */
  @NestedListField(
    () => StorySceneInputDto,
    exactItemsMessage(6, 'escenas'),
    ExactItems(6, 'escenas'),
    UniqueScenes(),
  )
  scenes!: StorySceneInputDto[]

  /** Los cuatro pasos del ritual (hasta 80 caracteres cada uno). */
  @TextListField(80, exactItemsMessage(4, 'pasos'), ExactItems(4, 'pasos'))
  ritualSteps!: string[]

  /** Productos del recorrido. */
  @NestedField(() => StoryProductsInputDto)
  storyProducts!: StoryProductsInputDto

  /** Encabezado de la colección. */
  @NestedField(() => SectionHeadingInputDto)
  collection!: SectionHeadingInputDto

  /** Encabezado de los destacados. */
  @NestedField(() => SectionHeadingInputDto)
  featured!: SectionHeadingInputDto

  /** Encabezado de las reseñas. */
  @NestedField(() => SectionHeadingInputDto)
  reviews!: SectionHeadingInputDto

  /** Manifiesto. */
  @NestedField(() => ManifestoInputDto)
  manifesto!: ManifestoInputDto

  /** Números del galpón. */
  @NestedField(() => StatsInputDto)
  stats!: StatsInputDto

  /** Bloque del kit. */
  @NestedField(() => KitBlockInputDto)
  kitBlock!: KitBlockInputDto
}

/** Portada de Nosotros. */
export class AboutHeroInputDto {
  /** Antetítulo. */
  @TextField(60)
  eyebrow!: string

  /** Líneas del título (1 a 3). */
  @TitleLinesField()
  titleLines!: string[]

  /** Texto, hasta 600 caracteres. */
  @TextField(600)
  text!: string
}

/** Socio de Nosotros, con su foto ya subida (`ImageInput`) o `null`. */
export class PartnerInputDto {
  /** Nombre, hasta 60 caracteres. */
  @TextField(60)
  name!: string

  /** Rol, hasta 80 caracteres. */
  @TextField(80)
  role!: string

  /** Foto (sin `url`: la arma el back) o `null`. */
  @NullableImageField()
  photo!: PartnerPhotoInput | null
}

/** Paso de Nosotros. */
export class AboutStepInputDto {
  /** Título, hasta 60 caracteres. */
  @TextField(60)
  title!: string

  /** Texto, hasta 400 caracteres. */
  @TextField(400)
  text!: string
}

/** Cuerpo de `PUT /admin/content/about` (`aboutContentFormSchema`, `AboutContentInput`). */
export class AboutContentInputDto implements AboutContentInput {
  /** Portada. */
  @NestedField(() => AboutHeroInputDto)
  hero!: AboutHeroInputDto

  /** Socios (hasta 8; puede quedar vacía). */
  @NestedListField(
    () => PartnerInputDto,
    maxItemsMessage(8, 'socios'),
    ArrayMaxSize(8, { message: maxItemsMessage(8, 'socios') }),
  )
  partners!: PartnerInputDto[]

  /** Cita, hasta 300 caracteres. */
  @TextField(300)
  quote!: string

  /** Antetítulo de los pasos. */
  @TextField(60)
  stepsEyebrow!: string

  /** Los tres pasos. */
  @NestedListField(() => AboutStepInputDto, exactItemsMessage(3, 'pasos'), ExactItems(3, 'pasos'))
  steps!: AboutStepInputDto[]

  /** Texto del botón. */
  @TextField(40)
  ctaLabel!: string
}

/** Pregunta frecuente. */
export class FaqItemInputDto {
  /** Pregunta, hasta 200 caracteres. */
  @TextField(200)
  question!: string

  /** Respuesta, hasta 2000 caracteres. */
  @TextField(2000)
  answer!: string
}

/** Categoría de preguntas frecuentes. */
export class FaqCategoryInputDto {
  /** Identificador (slug). */
  @SlugField()
  id!: string

  /** Nombre, hasta 40 caracteres. */
  @TextField(40)
  label!: string

  /** Preguntas (1 a 30). */
  @NestedListField(
    () => FaqItemInputDto,
    itemsBetweenMessage(1, 30, 'preguntas'),
    ItemsBetween(1, 30, 'preguntas'),
  )
  items!: FaqItemInputDto[]
}

/** Cuerpo de `PUT /admin/content/faq` (`faqContentFormSchema`). */
export class FaqContentInputDto implements FaqContent {
  /** Categorías (1 a 10). */
  @NestedListField(
    () => FaqCategoryInputDto,
    itemsBetweenMessage(1, 10, 'categorías'),
    ItemsBetween(1, 10, 'categorías'),
  )
  categories!: FaqCategoryInputDto[]
}

/** Cuerpo de `PUT /admin/content/footer` (`footerContentFormSchema`). */
export class FooterContentInputDto implements FooterContent {
  /** Frase corta, hasta 80 caracteres. */
  @TextField(80)
  tagline!: string

  /** Texto, hasta 300 caracteres. */
  @TextField(300)
  text!: string

  /** Medios de pago (hasta 10, de hasta 40 caracteres cada uno). */
  @TextListField(
    40,
    maxItemsMessage(10, 'medios de pago'),
    ArrayMaxSize(10, { message: maxItemsMessage(10, 'medios de pago') }),
  )
  paymentMethods!: string[]
}

/** Pestañas de la ficha de un grupo (`ProductTabsGroupContent`). */
export class ProductTabsGroupInputDto implements ProductTabsGroupContent {
  /** Nota bajo la descripción; vacía queda en `null`. */
  @NullableTextField(600)
  descriptionNote!: string | null

  /** Título de Materiales, hasta 30 caracteres. */
  @TextField(30)
  materialsTitle!: string

  /** Texto de Materiales, hasta 2000 caracteres. */
  @TextField(2000)
  materials!: string

  /** Título de Cuidado, hasta 30 caracteres. */
  @TextField(30)
  careTitle!: string

  /** Texto de Cuidado, hasta 2000 caracteres. */
  @TextField(2000)
  care!: string
}

/** Cuerpo de `PUT /admin/content/product-tabs` (`productTabsContentFormSchema`). */
export class ProductTabsContentInputDto implements ProductTabsContent {
  /** Pestañas de los mates. */
  @NestedField(() => ProductTabsGroupInputDto)
  mate!: ProductTabsGroupInputDto

  /** Pestañas de las bombillas. */
  @NestedField(() => ProductTabsGroupInputDto)
  bombilla!: ProductTabsGroupInputDto

  /** Pestañas de las yerbas. */
  @NestedField(() => ProductTabsGroupInputDto)
  yerba!: ProductTabsGroupInputDto

  /** Texto de Envíos, hasta 2000 caracteres. */
  @TextField(2000)
  shipping!: string
}

/** Cuerpo de `PUT /admin/content/legal/{document}` (`legalContentFormSchema`). */
export class LegalContentInputDto implements LegalContent {
  /** Título, hasta 120 caracteres. */
  @TextField(120)
  title!: string

  /** Fecha de la última actualización (`AAAA-MM-DD`, un día que existe). */
  @CalendarDateField()
  updatedAt!: string

  /**
   * Texto completo, hasta 60000 caracteres; sus marcadores `{{clave}}` usan claves de
   * `LEGAL_MARKERS` (si no, el mensaje con la primera desconocida).
   */
  @TextField(60_000)
  @ValidateBy(
    {
      name: 'custom',
      validator: {
        validate: (value) => typeof value !== 'string' || unknownLegalMarkers(value).length === 0,
      },
    },
    {
      message: ({ value }) =>
        unknownLegalMarkerMessage(
          typeof value === 'string' ? (unknownLegalMarkers(value)[0] ?? '') : '',
        ),
    },
  )
  body!: string
}
