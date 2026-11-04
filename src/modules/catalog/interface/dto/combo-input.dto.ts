// Cuerpos del dashboard para los combos (`ComboInput` y `ComboOrderInput` del contrato), con las
// reglas y los mensajes de `comboFormSchema` y `comboOrderSchema` de `@galpon/schemas`. Los
// decoradores de cada campo van en el orden de los schemas de zod: el primer error por campo es el
// mismo que el del front. Los elementos de las listas se validan con `EachItem`, así un producto
// sin elegir da `productIds.1` "Requerido" como en el front (Ruling B-64).

import { applyDecorators } from '@nestjs/common'
import { ApiProperty, ApiSchema } from '@nestjs/swagger'
import { Transform, type TransformFnParams } from 'class-transformer'
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator'

import {
  IDENTITY_MESSAGES,
  maxMessage,
  RawValue,
  Trimmed,
} from '../../../identity/interface/dto/identity-fields'
import { canonicalId } from '../../../../shared/domain/id'
import { ApiSchemaProperty } from '../../../../shared/infrastructure/http/openapi'
import { EachItem, type ItemRule } from '../../../../shared/infrastructure/http/validation.pipe'
import type { ComboFields } from '../../application/ports/combo.repository.port'
import {
  COMBO_MAX_ITEMS,
  COMBO_MIN_ITEMS,
  COMBO_STATUSES,
  type ComboStatus,
} from '../../domain/combo.entity'

/** Largo máximo del nombre de un combo. */
const NAME_MAX_LENGTH = 80

/** Largo mínimo del nombre de un combo. */
const NAME_MIN_LENGTH = 3

/** Largo máximo de la descripción de un combo. */
const DESCRIPTION_MAX_LENGTH = 300

/** Largo máximo de un id de producto o de combo. */
const ID_MAX_LENGTH = 80

/** Tope de un precio en pesos (`MAX_PESOS` del front). */
const MAX_PESOS = 99_999_999

/** Textos de error de los formularios de combos (los de `MESSAGES` del front). */
export const COMBO_INPUT_MESSAGES = {
  /** Texto obligatorio vacío, lista de ids vacía o id sin elegir. */
  required: IDENTITY_MESSAGES.required,
  /** Nombre de menos de 3 caracteres. */
  nameTooShort: `Mínimo ${String(NAME_MIN_LENGTH)} caracteres`,
  /** Lista de productos que no tiene de 2 a 3. */
  itemsBetween: `Cargá de ${String(COMBO_MIN_ITEMS)} a ${String(COMBO_MAX_ITEMS)} productos`,
  /** Producto repetido en el combo. */
  duplicateProducts: 'Cada producto tiene que aparecer una sola vez',
  /** Precio que no es un entero mayor a 0. */
  invalidPrice: 'Ingresá un precio en pesos mayor a 0',
  /** Precio mayor a $99.999.999. */
  priceTooHigh: 'El precio no puede superar los $99.999.999',
  /** Estado que no es borrador ni publicado. */
  invalidStatus: 'Elegí un estado',
  /** Combo repetido en el orden. */
  duplicateIds: 'Cada combo tiene que aparecer una sola vez',
} as const

/** Cada id de una lista es un texto con algo (ya recortado): si no, "Requerido" en su índice. */
const REQUIRED_ID: ItemRule = {
  name: 'requiredId',
  code: 'required',
  message: COMBO_INPUT_MESSAGES.required,
  isValid: (item) => typeof item === 'string' && item !== '',
}

/** Cada id de una lista tiene hasta 80 caracteres: si no, "Máximo 80 caracteres" en su índice. */
const ID_MAX: ItemRule = {
  name: 'idMaxLength',
  code: 'too_big',
  message: maxMessage(ID_MAX_LENGTH),
  isValid: (item) => typeof item !== 'string' || item.length <= ID_MAX_LENGTH,
}

/**
 * Junta las reglas de un campo en el orden en que se escriben, que es el orden de los errores (los
 * decoradores apilados se aplican de abajo hacia arriba).
 *
 * @param rules - Normalización y validaciones, en el orden del schema del front.
 */
function Validations(...rules: PropertyDecorator[]): PropertyDecorator {
  return applyDecorators(...rules)
}

/** Esquema de Swagger de un id de las listas. */
const ID_ITEM_SCHEMA = { type: 'string', minLength: 1, maxLength: ID_MAX_LENGTH } as const

/**
 * Lista cruda del JSON con cada texto recortado y, si es un UUID, en minúsculas
 * ({@link canonicalId}: así un producto repetido con otras mayúsculas también es "repetido"); lo
 * que no es texto queda como vino y la validación lo rechaza. Sin la conversión implícita del
 * pipe global.
 */
function trimmedItems({ obj, key }: TransformFnParams): unknown {
  const value: unknown = (obj as Record<string, unknown>)[key]
  return Array.isArray(value)
    ? value.map((item: unknown) => (typeof item === 'string' ? canonicalId(item.trim()) : item))
    : value
}

/**
 * Lista de ids recortados (`z.array(requiredText(1, 80))` del front): primero que sea una lista,
 * después cada elemento por índice y al final las reglas propias de la lista.
 *
 * @param notArrayMessage - Mensaje si no es una lista.
 * @param listRules - Reglas de la lista entera, en el orden del schema del front.
 */
export function IdList(
  notArrayMessage: string,
  ...listRules: PropertyDecorator[]
): PropertyDecorator {
  return applyDecorators(
    Transform(trimmedItems),
    IsArray({ message: notArrayMessage }),
    EachItem(REQUIRED_ID),
    EachItem(ID_MAX),
    ...listRules,
  )
}

/** Cuerpo de `POST /admin/combos` y `PATCH /admin/combos/{id}` (`ComboInput`). */
@ApiSchema({ name: 'ComboInput' })
export class ComboInputDto {
  /** Nombre, de 3 a 80 caracteres (se recorta). */
  @ApiProperty({
    type: 'string',
    minLength: NAME_MIN_LENGTH,
    maxLength: NAME_MAX_LENGTH,
    description: 'Nombre del combo, de 3 a 80 caracteres (se recorta).',
  })
  @Validations(
    Trimmed(),
    IsString({ message: COMBO_INPUT_MESSAGES.required }),
    IsNotEmpty({ message: COMBO_INPUT_MESSAGES.required }),
    MinLength(NAME_MIN_LENGTH, { message: COMBO_INPUT_MESSAGES.nameTooShort }),
    MaxLength(NAME_MAX_LENGTH, { message: maxMessage(NAME_MAX_LENGTH) }),
  )
  name!: string

  /** Descripción corta, de hasta 300 caracteres (se recorta; puede ser vacía). */
  @ApiProperty({
    type: 'string',
    maxLength: DESCRIPTION_MAX_LENGTH,
    description: 'Texto corto del combo, de hasta 300 caracteres (se recorta). Puede ser vacío.',
  })
  @Validations(
    Trimmed(),
    IsString({ message: COMBO_INPUT_MESSAGES.required }),
    MaxLength(DESCRIPTION_MAX_LENGTH, { message: maxMessage(DESCRIPTION_MAX_LENGTH) }),
  )
  description!: string

  /** Productos del combo, de 2 a 3 y sin repetir, en el orden en que se muestran. */
  @ApiSchemaProperty({
    type: 'array',
    description: 'Productos del combo, de 2 a 3 y sin repetir, en el orden en que se muestran.',
    minItems: COMBO_MIN_ITEMS,
    maxItems: COMBO_MAX_ITEMS,
    uniqueItems: true,
    items: ID_ITEM_SCHEMA,
  })
  @IdList(
    COMBO_INPUT_MESSAGES.itemsBetween,
    ArrayMinSize(COMBO_MIN_ITEMS, { message: COMBO_INPUT_MESSAGES.itemsBetween }),
    ArrayMaxSize(COMBO_MAX_ITEMS, { message: COMBO_INPUT_MESSAGES.itemsBetween }),
    ArrayUnique({ message: COMBO_INPUT_MESSAGES.duplicateProducts }),
  )
  productIds!: string[]

  /** Precio final en pesos, de 1 a 99.999.999 (crudo del JSON: `"10"` no pasa). */
  @ApiProperty({
    type: 'integer',
    minimum: 1,
    maximum: MAX_PESOS,
    description: 'Precio final del combo en pesos, de 1 a 99.999.999.',
  })
  @Validations(
    RawValue(),
    IsInt({ message: COMBO_INPUT_MESSAGES.invalidPrice }),
    Min(1, { message: COMBO_INPUT_MESSAGES.invalidPrice }),
    Max(MAX_PESOS, { message: COMBO_INPUT_MESSAGES.priceTooHigh }),
  )
  priceArs!: number

  /** Borrador o publicado. */
  @ApiProperty({ enum: [...COMBO_STATUSES], enumName: 'ComboStatus' })
  @Validations(RawValue(), IsIn(COMBO_STATUSES, { message: COMBO_INPUT_MESSAGES.invalidStatus }))
  status!: ComboStatus

  /**
   * Los datos para los casos de uso.
   *
   * @returns Los campos del combo, ya normalizados.
   */
  toFields(): ComboFields {
    return {
      name: this.name,
      description: this.description,
      productIds: [...this.productIds],
      priceArs: this.priceArs,
      status: this.status,
    }
  }
}

/** Cuerpo de `PUT /admin/combos/order` (`ComboOrderInput`). */
@ApiSchema({ name: 'ComboOrderInput' })
export class ComboOrderInputDto {
  /** Todos los combos, una vez cada uno, en el orden nuevo (recortados). */
  @ApiSchemaProperty({
    type: 'array',
    description:
      'Identificadores de todos los combos, una vez cada uno, en el orden en que se muestran.',
    minItems: 1,
    uniqueItems: true,
    items: ID_ITEM_SCHEMA,
  })
  @IdList(
    COMBO_INPUT_MESSAGES.required,
    ArrayMinSize(1, { message: COMBO_INPUT_MESSAGES.required }),
    ArrayUnique({ message: COMBO_INPUT_MESSAGES.duplicateIds }),
  )
  ids!: string[]
}
