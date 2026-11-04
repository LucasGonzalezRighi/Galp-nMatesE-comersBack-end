// Cuerpos del dashboard para las líneas (`CategoryInput` y `CategoryOrderInput` del contrato),
// con las reglas y los mensajes de `categoryFormSchema` y `categoryOrderSchema` de
// `@galpon/schemas`, en el orden de zod (el primer error por campo es el del front).

import { applyDecorators } from '@nestjs/common'
import { ApiProperty, ApiSchema } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  ArrayMinSize,
  ArrayUnique,
  IsDefined,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator'

import {
  IDENTITY_MESSAGES,
  maxMessage,
  RawValue,
  Trimmed,
} from '../../../identity/interface/dto/identity-fields'
import { SlugField } from '../../../content/interface/dto/form-fields'
import { ImageInputDto } from '../../../../shared/infrastructure/http/image-input.dto'
import {
  ApiSchemaProperty,
  nullableRef,
  SLUG_MAX_LENGTH,
  SLUG_PATTERN,
} from '../../../../shared/infrastructure/http/openapi'
import type { AdminCategoryFields } from '../../application/ports/admin-category.repository.port'
import { PRODUCT_GROUPS, type ProductGroup } from '../../domain/category.entity'
import { IdList } from './combo-input.dto'

/** Largo máximo de la bajada de una línea. */
const BLURB_MAX_LENGTH = 200

/** Textos de error de los formularios de líneas (los de `MESSAGES` del front). */
export const CATEGORY_INPUT_MESSAGES = {
  /** Obligatorio vacío o de otro tipo. */
  required: IDENTITY_MESSAGES.required,
  /** Nombre de menos de 2 caracteres. */
  nameTooShort: 'Mínimo 2 caracteres',
  /** Grupo que no es mate, bombilla ni yerba. */
  invalidGroup: 'Elegí un grupo',
  /** Línea repetida en el orden. */
  duplicateIds: 'Cada línea tiene que aparecer una sola vez',
} as const

/**
 * Junta las reglas de un campo en el orden en que se escriben, que es el orden de los errores.
 *
 * @param rules - Normalización y validaciones, en el orden del schema del front.
 */
function Validations(...rules: PropertyDecorator[]): PropertyDecorator {
  return applyDecorators(...rules)
}

/** Cuerpo de `POST /admin/categories` y `PATCH /admin/categories/{id}` (`CategoryInput`). */
@ApiSchema({ name: 'CategoryInput' })
export class CategoryInputDto {
  /** Nombre, de 2 a 60 caracteres (se recorta). */
  @ApiProperty({ type: 'string', minLength: 2, maxLength: 60, description: 'Nombre de la línea.' })
  @Validations(
    Trimmed(),
    IsString({ message: CATEGORY_INPUT_MESSAGES.required }),
    IsNotEmpty({ message: CATEGORY_INPUT_MESSAGES.required }),
    MinLength(2, { message: CATEGORY_INPUT_MESSAGES.nameTooShort }),
    MaxLength(60, { message: maxMessage(60) }),
  )
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

  /** Grupo de la línea. */
  @ApiProperty({ enum: [...PRODUCT_GROUPS], enumName: 'ProductGroup' })
  @Validations(RawValue(), IsIn(PRODUCT_GROUPS, { message: CATEGORY_INPUT_MESSAGES.invalidGroup }))
  group!: ProductGroup

  /** Bajada, hasta 200 caracteres (se recorta; puede quedar vacía). */
  @ApiProperty({
    type: 'string',
    maxLength: BLURB_MAX_LENGTH,
    description: 'Descripción corta de la línea; puede ser vacía.',
  })
  @Validations(
    Trimmed(),
    IsString({ message: CATEGORY_INPUT_MESSAGES.required }),
    MaxLength(BLURB_MAX_LENGTH, { message: maxMessage(BLURB_MAX_LENGTH) }),
  )
  blurb!: string

  /** Foto (sin `url`: la arma el back) o `null`; si falta o no es un objeto, "Requerido". */
  @ApiSchemaProperty(nullableRef('ImageInput'))
  @Validations(
    ValidateIf((_object, value) => value !== null),
    IsDefined({ message: CATEGORY_INPUT_MESSAGES.required }),
    IsObject({ message: CATEGORY_INPUT_MESSAGES.required }),
    ValidateNested({ message: CATEGORY_INPUT_MESSAGES.required }),
    Type(() => ImageInputDto),
  )
  image!: ImageInputDto | null

  /**
   * Los datos para los casos de uso.
   *
   * @returns La línea, ya normalizada.
   */
  toFields(): AdminCategoryFields {
    const { image } = this
    return {
      name: this.name,
      slug: this.slug,
      group: this.group,
      blurb: this.blurb,
      image:
        image === null
          ? null
          : { publicId: image.publicId, width: image.width, height: image.height, alt: image.alt },
    }
  }
}

/** Cuerpo de `PUT /admin/categories/order` (`CategoryOrderInput`). */
@ApiSchema({ name: 'CategoryOrderInput' })
export class CategoryOrderInputDto {
  /** Todas las líneas, una vez cada una, en el orden nuevo (recortadas). */
  @ApiSchemaProperty({
    type: 'array',
    description:
      'Identificadores de todas las líneas, una vez cada una, en el orden en que se muestran.',
    minItems: 1,
    uniqueItems: true,
    items: { type: 'string', minLength: 1, maxLength: 80 },
  })
  @IdList(
    CATEGORY_INPUT_MESSAGES.required,
    ArrayMinSize(1, { message: CATEGORY_INPUT_MESSAGES.required }),
    ArrayUnique({ message: CATEGORY_INPUT_MESSAGES.duplicateIds }),
  )
  ids!: string[]
}
