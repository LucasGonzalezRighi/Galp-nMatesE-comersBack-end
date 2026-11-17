// Reglas de los formularios del dashboard que comparten contenidos y ajustes: las de los helpers
// de `@galpon/schemas` (`text`, `nullableText`, `slugSchema`, listas, enteros con rango, URL http,
// fecha `AAAA-MM-DD`), con los mismos mensajes. Cada decorador junta la normalización
// (`@Transform`) y las validaciones en el orden del schema de zod: el primer error por campo es el
// mismo que el del front. Lo que los casos compartidos no cubren dice "Requerido" o el mensaje de
// la lista (Ruling B-79), nunca los textos en inglés de `class-validator`.

import { applyDecorators } from '@nestjs/common'
import { Transform, type TransformFnParams, Type } from 'class-transformer'
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDefined,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateBy,
  ValidateIf,
  ValidateNested,
} from 'class-validator'

import { maxMessage, RawValue, Trimmed } from '../../../identity/interface/dto/identity-fields'
import { SLUG_MAX_LENGTH, SLUG_PATTERN } from '../../../../shared/infrastructure/http/openapi'
import { EachItem, type ItemRule } from '../../../../shared/infrastructure/http/validation.pipe'

/** Largo máximo de una URL (`consumerLinks`, `seller.dataFiscalUrl`). */
export const URL_MAX_LENGTH = 2048

/** Fecha sin hora, como `LegalContent.updatedAt`. */
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

/** Textos de error de los formularios del dashboard (los de `MESSAGES` del front). */
export const FORM_MESSAGES = {
  /** Obligatorio vacío, o un dato que no es del tipo esperado. */
  required: 'Requerido',
  /** Slug con algo que no es minúscula, número o guion simple. */
  invalidSlug: 'Solo minúsculas, números y guiones',
  /** URL que no es http ni https. */
  invalidUrl: 'Ingresá una URL válida, con http:// o https://',
  /** Fecha que no es un día real `AAAA-MM-DD`. */
  invalidDate: 'Ingresá una fecha válida (AAAA-MM-DD)',
  /** Escena del inicio repetida. */
  duplicateScenes: 'Cada escena tiene que aparecer una sola vez',
} as const

/**
 * Entero fuera de rango (`MESSAGES.intBetween`).
 *
 * @param min - Menor valor permitido.
 * @param max - Mayor valor permitido.
 * @returns `Ingresá un número entero entre <min> y <max>`.
 */
export function intBetweenMessage(min: number, max: number): string {
  return `Ingresá un número entero entre ${String(min)} y ${String(max)}`
}

/**
 * Número fuera de rango (`MESSAGES.numberBetween`).
 *
 * @param min - Menor valor permitido.
 * @param max - Mayor valor permitido.
 * @returns `Ingresá un número entre <min> y <max>`.
 */
export function numberBetweenMessage(min: number, max: number): string {
  return `Ingresá un número entre ${String(min)} y ${String(max)}`
}

/**
 * Lista con una cantidad fija (`MESSAGES.exactItems`).
 *
 * @param count - Cantidad exacta.
 * @param noun - Los elementos en plural ("escenas").
 * @returns `Tienen que ser <count> <noun>`.
 */
export function exactItemsMessage(count: number, noun: string): string {
  return `Tienen que ser ${String(count)} ${noun}`
}

/**
 * Lista con mínimo y máximo (`MESSAGES.itemsBetween`).
 *
 * @param min - Menor cantidad.
 * @param max - Mayor cantidad.
 * @param noun - Los elementos en plural ("líneas").
 * @returns `Cargá de <min> a <max> <noun>`.
 */
export function itemsBetweenMessage(min: number, max: number, noun: string): string {
  return `Cargá de ${String(min)} a ${String(max)} ${noun}`
}

/**
 * Lista con un máximo (`MESSAGES.maxItems`).
 *
 * @param max - Mayor cantidad.
 * @param noun - Los elementos en plural ("socios").
 * @returns `Máximo <max> <noun>`.
 */
export function maxItemsMessage(max: number, noun: string): string {
  return `Máximo ${String(max)} ${noun}`
}

/**
 * Indica si un texto es una URL `http://` o `https://` que se puede leer (como
 * `z.url({ protocol: /^https?$/ })`, que además pide el `//`).
 *
 * @param value - Texto ya recortado.
 * @returns `true` si es una URL http o https.
 */
export function isHttpUrl(value: string): boolean {
  if (!/^https?:\/\//i.test(value) || !URL.canParse(value)) return false
  const { protocol } = new URL(value)
  return protocol === 'http:' || protocol === 'https:'
}

/**
 * Indica si un texto `AAAA-MM-DD` es un día que existe (el 30 de febrero, no), como
 * `isCalendarDate` del front.
 *
 * @param value - Texto a revisar.
 * @returns `true` si tiene el formato y el día existe.
 */
export function isCalendarDate(value: string): boolean {
  const match = DATE_PATTERN.exec(value)
  if (match === null) return false
  const date = new Date(`${value}T00:00:00Z`)
  return (
    date.getUTCFullYear() === Number(match[1]) &&
    date.getUTCMonth() + 1 === Number(match[2]) &&
    date.getUTCDate() === Number(match[3])
  )
}

/** Valor crudo: texto recortado y, si queda vacío, `null`; `null` sigue `null`; lo demás, igual. */
function trimmedOrNull({ obj, key }: TransformFnParams): unknown {
  const value: unknown = (obj as Record<string, unknown>)[key]
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/** Lista cruda con cada texto recortado (lo que no es texto queda como vino). */
function trimmedItems({ obj, key }: TransformFnParams): unknown {
  const value: unknown = (obj as Record<string, unknown>)[key]
  return Array.isArray(value)
    ? value.map((item: unknown) => (typeof item === 'string' ? item.trim() : item))
    : value
}

/** Cada elemento es un texto con algo (ya recortado): si no, "Requerido" en su índice. */
const REQUIRED_ITEM: ItemRule = {
  name: 'requiredItem',
  code: 'required',
  message: FORM_MESSAGES.required,
  isValid: (item) => typeof item === 'string' && item !== '',
}

/** Cada elemento tiene hasta `max` caracteres: si no, "Máximo n caracteres" en su índice. */
function maxItem(max: number): ItemRule {
  return {
    name: 'maxLengthItem',
    code: 'too_big',
    message: maxMessage(max),
    isValid: (item) => typeof item !== 'string' || item.length <= max,
  }
}

/** Cada elemento tiene forma de slug: si no, "Solo minúsculas, números y guiones". */
const SLUG_ITEM: ItemRule = {
  name: 'slugItem',
  code: 'invalid_format',
  message: FORM_MESSAGES.invalidSlug,
  isValid: (item) => typeof item !== 'string' || item === '' || SLUG_PATTERN.test(item),
}

/**
 * Texto obligatorio (`text(max)` del front): se recorta, vacío o de otro tipo da "Requerido" y
 * más largo que `max` da "Máximo n caracteres".
 *
 * @param max - Máximo de caracteres.
 * @returns El decorador de la propiedad.
 */
export function TextField(max: number): PropertyDecorator {
  return applyDecorators(
    Trimmed(),
    IsString({ message: FORM_MESSAGES.required }),
    IsNotEmpty({ message: FORM_MESSAGES.required }),
    MaxLength(max, { message: maxMessage(max) }),
  )
}

/**
 * Texto que puede faltar (`nullableText(max)` y `sellerText(max)` del front): se recorta y, si
 * queda vacío (o es `null`), sale `null`; si no es texto ni `null`, "Requerido".
 *
 * @param max - Máximo de caracteres.
 * @returns El decorador de la propiedad.
 */
export function NullableTextField(max: number): PropertyDecorator {
  return applyDecorators(
    Transform(trimmedOrNull),
    ValidateIf((_object, value) => value !== null),
    IsString({ message: FORM_MESSAGES.required }),
    MaxLength(max, { message: maxMessage(max) }),
  )
}

/**
 * URL http o https obligatoria (`consumerLinks` de los ajustes): se recorta; vacía da "Requerido";
 * hasta 2048 caracteres.
 *
 * @returns El decorador de la propiedad.
 */
export function RequiredUrlField(): PropertyDecorator {
  return applyDecorators(
    Trimmed(),
    IsString({ message: FORM_MESSAGES.required }),
    IsNotEmpty({ message: FORM_MESSAGES.required }),
    MaxLength(URL_MAX_LENGTH, { message: maxMessage(URL_MAX_LENGTH) }),
    ValidateBy(
      {
        name: 'isHttpUrl',
        validator: { validate: (value) => typeof value === 'string' && isHttpUrl(value) },
      },
      { message: FORM_MESSAGES.invalidUrl },
    ),
  )
}

/**
 * Slug (`slugSchema` del front): recortado, obligatorio, hasta 80 caracteres y con minúsculas,
 * números y guiones simples.
 *
 * @returns El decorador de la propiedad.
 */
export function SlugField(): PropertyDecorator {
  return applyDecorators(
    TextField(SLUG_MAX_LENGTH),
    Matches(SLUG_PATTERN, { message: FORM_MESSAGES.invalidSlug }),
  )
}

/**
 * Fecha `AAAA-MM-DD` obligatoria que existe en el calendario (`LegalContent.updatedAt`).
 *
 * @returns El decorador de la propiedad.
 */
export function CalendarDateField(): PropertyDecorator {
  return applyDecorators(
    Trimmed(),
    IsString({ message: FORM_MESSAGES.required }),
    IsNotEmpty({ message: FORM_MESSAGES.required }),
    ValidateBy(
      {
        name: 'isCalendarDate',
        validator: { validate: (value) => typeof value === 'string' && isCalendarDate(value) },
      },
      { message: FORM_MESSAGES.invalidDate },
    ),
  )
}

/**
 * Entero entre `min` y `max` con un solo mensaje para todo lo que falle (`boundedInt`), crudo del
 * JSON (`"3"` no pasa).
 *
 * @param min - Menor valor permitido.
 * @param max - Mayor valor permitido.
 * @returns El decorador de la propiedad.
 */
export function IntField(min: number, max: number): PropertyDecorator {
  const message = intBetweenMessage(min, max)
  return applyDecorators(
    RawValue(),
    IsInt({ message }),
    Min(min, { message }),
    Max(max, { message }),
  )
}

/**
 * Número (con decimales) entre `min` y `max`, crudo del JSON.
 *
 * @param min - Menor valor permitido.
 * @param max - Mayor valor permitido.
 * @returns El decorador de la propiedad.
 */
export function NumberField(min: number, max: number): PropertyDecorator {
  const message = numberBetweenMessage(min, max)
  return applyDecorators(
    RawValue(),
    IsNumber({ allowNaN: false, allowInfinity: false }, { message }),
    Min(min, { message }),
    Max(max, { message }),
  )
}

/**
 * Booleano de JSON (`"true"` no pasa); otra cosa da "Requerido".
 *
 * @returns El decorador de la propiedad.
 */
export function BooleanField(): PropertyDecorator {
  return applyDecorators(RawValue(), IsBoolean({ message: FORM_MESSAGES.required }))
}

/**
 * Objeto anidado obligatorio, validado con su clase; si falta o no es un objeto, "Requerido".
 *
 * @param type - Clase del objeto.
 * @returns El decorador de la propiedad.
 */
export function NestedField(type: () => new () => object): PropertyDecorator {
  const message = FORM_MESSAGES.required
  return applyDecorators(
    IsDefined({ message }),
    IsObject({ message }),
    ValidateNested({ message }),
    Type(type),
  )
}

/**
 * Lista de objetos validados con su clase: si no es una lista, `notArrayMessage`; un elemento que
 * no es un objeto da "Requerido" en su índice; después, las reglas de la lista.
 *
 * @param type - Clase de cada elemento.
 * @param notArrayMessage - Mensaje si no es una lista (el de la cantidad).
 * @param listRules - Reglas de la lista entera, en el orden del schema del front.
 * @returns El decorador de la propiedad.
 */
export function NestedListField(
  type: () => new () => object,
  notArrayMessage: string,
  ...listRules: PropertyDecorator[]
): PropertyDecorator {
  return applyDecorators(
    IsArray({ message: notArrayMessage }),
    ValidateNested({ each: true, message: FORM_MESSAGES.required }),
    Type(type),
    ...listRules,
  )
}

/**
 * Lista de textos obligatorios recortados (`z.array(text(max))`): si no es una lista,
 * `notArrayMessage`; cada elemento vacío o de otro tipo da "Requerido" y uno largo "Máximo n
 * caracteres" en su índice; después, las reglas de la lista.
 *
 * @param max - Máximo de caracteres de cada texto.
 * @param notArrayMessage - Mensaje si no es una lista (el de la cantidad).
 * @param listRules - Reglas de la lista entera.
 * @returns El decorador de la propiedad.
 */
export function TextListField(
  max: number,
  notArrayMessage: string,
  ...listRules: PropertyDecorator[]
): PropertyDecorator {
  return applyDecorators(
    Transform(trimmedItems),
    IsArray({ message: notArrayMessage }),
    EachItem(REQUIRED_ITEM),
    EachItem(maxItem(max)),
    ...listRules,
  )
}

/**
 * Lista de exactamente `count` slugs (`exactList(slugSchema, count, noun)`).
 *
 * @param count - Cantidad exacta.
 * @param noun - Los elementos en plural, para el mensaje ("bombillas").
 * @returns El decorador de la propiedad.
 */
export function SlugListField(count: number, noun: string): PropertyDecorator {
  const message = exactItemsMessage(count, noun)
  return applyDecorators(
    Transform(trimmedItems),
    IsArray({ message }),
    EachItem(REQUIRED_ITEM),
    EachItem(maxItem(SLUG_MAX_LENGTH)),
    EachItem(SLUG_ITEM),
    ArrayMinSize(count, { message }),
    ArrayMaxSize(count, { message }),
  )
}

/**
 * Cantidad exacta de elementos de una lista (`exactList`).
 *
 * @param count - Cantidad exacta.
 * @param noun - Los elementos en plural.
 * @returns El decorador de la propiedad.
 */
export function ExactItems(count: number, noun: string): PropertyDecorator {
  const message = exactItemsMessage(count, noun)
  return applyDecorators(ArrayMinSize(count, { message }), ArrayMaxSize(count, { message }))
}

/**
 * Cantidad de elementos entre `min` y `max` (`boundedList`).
 *
 * @param min - Menor cantidad.
 * @param max - Mayor cantidad.
 * @param noun - Los elementos en plural.
 * @returns El decorador de la propiedad.
 */
export function ItemsBetween(min: number, max: number, noun: string): PropertyDecorator {
  const message = itemsBetweenMessage(min, max, noun)
  return applyDecorators(ArrayMinSize(min, { message }), ArrayMaxSize(max, { message }))
}
