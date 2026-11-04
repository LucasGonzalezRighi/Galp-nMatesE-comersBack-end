// Cuerpo de `PUT /admin/settings` (`AdminSettings`), con las reglas y los mensajes de
// `settingsFormSchema` de `@galpon/schemas`. No lleva `@ApiSchema`: el cuerpo es el mismo esquema
// que la respuesta y lo documenta el controlador con `schemaRef('AdminSettings')`.

import { applyDecorators } from '@nestjs/common'
import { Transform, type TransformFnParams } from 'class-transformer'
import {
  Allow,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateBy,
  ValidateIf,
} from 'class-validator'

import {
  BooleanField,
  FORM_MESSAGES,
  IntField,
  NestedField,
  NestedListField,
  NullableTextField,
  NullableUrlField,
  NumberField,
} from '../../../content/interface/dto/form-fields'
import {
  EmailField,
  maxMessage,
  RawValue,
  Trimmed,
} from '../../../identity/interface/dto/identity-fields'
import type { AdminSettingsInput } from '../../application/commands/update-settings.command'
import type { ShippingOptionChanges } from '../../application/ports/settings.repository.port'
import {
  type Seller,
  SHIPPING_METHODS,
  type ShippingMethod,
} from '../../domain/store-settings.entity'

/** Mayor costo de envío en pesos. */
const MAX_PESOS = 99_999_999

/** CUIT con los 11 dígitos pegados o con los guiones en su lugar (`20-12345678-6`). */
const CUIT_PATTERN = /^(?:\d{11}|\d{2}-\d{8}-\d)$/

/** Pesos de los primeros 10 dígitos del CUIT para el dígito verificador. */
const CUIT_WEIGHTS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2] as const

/** Textos de error de los ajustes (los de `MESSAGES` del front). */
export const SETTINGS_INPUT_MESSAGES = {
  /** Costo que no es un entero desde 0. */
  invalidAmount: 'Ingresá un monto en pesos, entero y desde 0',
  /** Costo de más de 99.999.999. */
  amountTooHigh: 'El monto no puede superar los $99.999.999',
  /** Envíos que no son uno por método (también un método desconocido). */
  invalidShippingOptions: 'Cargá los tres métodos de envío, uno de cada tipo',
  /** CUIT con otro formato o con el dígito verificador equivocado. */
  invalidCuit: 'CUIT inválido',
  /** Plazo de menos de 2 caracteres. */
  etaTooShort: 'Mínimo 2 caracteres',
} as const

/**
 * Indica si un CUIT de 11 dígitos tiene el dígito verificador que corresponde (`11 - suma % 11`;
 * 11 vale 0 y 10 no es válido), como `hasValidCuitCheckDigit` del front.
 *
 * @param digits - Los 11 dígitos, sin guiones.
 * @returns `true` si el último dígito es el verificador.
 */
export function hasValidCuitCheckDigit(digits: string): boolean {
  if (!/^\d{11}$/.test(digits)) return false
  const sum = CUIT_WEIGHTS.reduce(
    (total, weight, index) => total + weight * Number(digits.charAt(index)),
    0,
  )
  const remainder = sum % 11
  const expected = remainder === 0 ? 0 : 11 - remainder
  return Number(digits.charAt(10)) === expected
}

/**
 * Indica si las opciones de envío son exactamente una por método (`hasEachShippingMethodOnce`).
 *
 * @param value - Lista del cuerpo.
 * @returns `true` si están `home`, `branch` y `pickup`, una vez cada uno.
 */
function hasEachShippingMethodOnce(value: unknown): boolean {
  if (!Array.isArray(value) || value.length !== SHIPPING_METHODS.length) return false
  const methods = value.map((option: unknown): unknown =>
    typeof option === 'object' && option !== null ? Reflect.get(option, 'method') : undefined,
  )
  return SHIPPING_METHODS.every((method) => methods.filter((item) => item === method).length === 1)
}

/** CUIT crudo: recortado; vacío queda en `null`; con un formato válido, sin los guiones. */
function normalizedCuit({ obj, key }: TransformFnParams): unknown {
  const value: unknown = (obj as Record<string, unknown>)[key]
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  if (trimmed === '') return null
  return CUIT_PATTERN.test(trimmed) ? trimmed.replace(/-/g, '') : trimmed
}

/**
 * CUIT que puede faltar (`emptyAsNull(cuitSchema)`): vacío o `null` queda en `null`; si no es
 * texto, "Requerido"; con otro formato o el dígito verificador equivocado, "CUIT inválido". Sale
 * con los 11 dígitos.
 *
 * @returns El decorador de la propiedad.
 */
function CuitField(): PropertyDecorator {
  const message = SETTINGS_INPUT_MESSAGES.invalidCuit
  return applyDecorators(
    Transform(normalizedCuit),
    ValidateIf((_object, value) => value !== null),
    IsString({ message: FORM_MESSAGES.required }),
    Matches(CUIT_PATTERN, { message }),
    ValidateBy(
      {
        name: 'cuitCheckDigit',
        validator: {
          validate: (value) => typeof value === 'string' && hasValidCuitCheckDigit(value),
        },
      },
      { message },
    ),
  )
}

/**
 * Costo de envío en pesos (crudo del JSON): entero desde 0 y hasta 99.999.999.
 *
 * @returns El decorador de la propiedad.
 */
function AmountField(): PropertyDecorator {
  const message = SETTINGS_INPUT_MESSAGES.invalidAmount
  return applyDecorators(
    RawValue(),
    IsInt({ message }),
    Min(0, { message }),
    Max(MAX_PESOS, { message: SETTINGS_INPUT_MESSAGES.amountTooHigh }),
  )
}

/**
 * Plazo de un envío (`requiredText(2, 60)`): recortado, vacío da "Requerido", después el mínimo
 * y el máximo.
 *
 * @returns El decorador de la propiedad.
 */
function EtaField(): PropertyDecorator {
  return applyDecorators(
    Trimmed(),
    IsString({ message: FORM_MESSAGES.required }),
    IsNotEmpty({ message: FORM_MESSAGES.required }),
    MinLength(2, { message: SETTINGS_INPUT_MESSAGES.etaTooShort }),
    MaxLength(60, { message: maxMessage(60) }),
  )
}

/** Opción de envío del cuerpo: el `label` se acepta y se ignora (el nombre es fijo). */
export class ShippingOptionInputDto implements ShippingOptionChanges {
  /** Método. */
  @IsIn(SHIPPING_METHODS, { message: SETTINGS_INPUT_MESSAGES.invalidShippingOptions })
  method!: ShippingMethod

  /** Costo en pesos enteros, de 0 a 99.999.999. */
  @AmountField()
  costArs!: number

  /** Plazo estimado, de 2 a 60 caracteres (se recorta). */
  @EtaField()
  eta!: string

  /** Si la tienda lo ofrece. */
  @BooleanField()
  enabled!: boolean

  /** Nombre que manda el dashboard: se acepta y se descarta (Ruling B-79). */
  @Allow()
  label?: unknown
}

/** Cuotas sin interés. */
export class InstallmentsInputDto {
  /** Máximo de cuotas sin interés, de 1 a 12. */
  @IntField(1, 12)
  maxWithoutInterest!: number

  /** Si se muestran en la ficha. */
  @BooleanField()
  showOnProduct!: boolean
}

/** Cómo se muestra el precio. */
export class PriceDisplayInputDto {
  /** Si se muestra el precio sin impuestos nacionales. */
  @BooleanField()
  showNetPrice!: boolean
}

/** Datos del vendedor: cada uno texto o `null` (vacío queda en `null`). */
export class SellerInputDto implements Seller {
  /** Razón social, hasta 120 caracteres. */
  @NullableTextField(120)
  legalName!: string | null

  /** CUIT, sale con 11 dígitos. */
  @CuitField()
  cuit!: string | null

  /** Condición frente al IVA, hasta 60 caracteres. */
  @NullableTextField(60)
  taxCondition!: string | null

  /** Domicilio, hasta 200 caracteres. */
  @NullableTextField(200)
  address!: string | null

  /** Teléfono, hasta 60 caracteres. */
  @NullableTextField(60)
  phone!: string | null

  /** Área de atención, hasta 80 caracteres. */
  @NullableTextField(80)
  supportArea!: string | null

  /** Horario de atención, hasta 120 caracteres. */
  @NullableTextField(120)
  supportHours!: string | null

  /** URL del formulario "Data fiscal" (http o https). */
  @NullableUrlField()
  dataFiscalUrl!: string | null
}

/** Cuerpo de `PUT /admin/settings` (`settingsFormSchema`). */
export class AdminSettingsInputDto implements AdminSettingsInput {
  /** Descuento del kit, entero de 0 a 30. */
  @IntField(0, 30)
  kitDiscountPercent!: number

  /** Las tres opciones de envío, una por método. */
  @NestedListField(
    () => ShippingOptionInputDto,
    SETTINGS_INPUT_MESSAGES.invalidShippingOptions,
    ValidateBy(
      { name: 'eachShippingMethodOnce', validator: { validate: hasEachShippingMethodOnce } },
      { message: SETTINGS_INPUT_MESSAGES.invalidShippingOptions },
    ),
  )
  shippingOptions!: ShippingOptionInputDto[]

  /** Cuotas sin interés. */
  @NestedField(() => InstallmentsInputDto)
  installments!: InstallmentsInputDto

  /** Email de contacto (se recorta y pasa a minúsculas). */
  @EmailField()
  contactEmail!: string

  /** Umbral de poco stock, entero de 0 a 999. */
  @IntField(0, 999)
  lowStockThreshold!: number

  /** Alícuota de IVA, de 0 a 100 con decimales (se guarda con 2). */
  @NumberField(0, 100)
  vatRatePercent!: number

  /** Cómo se muestra el precio. */
  @NestedField(() => PriceDisplayInputDto)
  priceDisplay!: PriceDisplayInputDto

  /** Datos del vendedor. */
  @NestedField(() => SellerInputDto)
  seller!: SellerInputDto
}
