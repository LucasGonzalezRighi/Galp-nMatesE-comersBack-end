import { ApiProperty, ApiSchema } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator'

import { type Province, PROVINCES } from '../../../modules/identity/domain/province'
import { ApiSchemaProperty, namedRef } from './openapi'
import { StorableText } from './storable-text.validator'

// La capa `infrastructure` compartida no puede importar la `interface` de identidad (fronteras de
// ESLint), así que los textos, los patrones y el recorte de abajo repiten los de
// `src/modules/identity/interface/dto/identity-fields.ts` (los mismos que `MESSAGES` del front).
// Los casos de validación del front (`shippingSchema`, `address.*`) cubren los dos.

/** Textos de error de la dirección, los mismos que `MESSAGES` del front. */
const ADDRESS_MESSAGES = {
  required: 'Requerido',
  invalidStreetNumber: 'Ingresá el número o S/N',
  invalidPostalCode: 'Código postal inválido',
  invalidProvince: 'Elegí una provincia',
  invalidText: 'Ingresá un texto',
} as const

/** Patrón del número de calle: de 1 a 5 dígitos o `S/N`. */
const STREET_NUMBER_PATTERN = '^(?:[0-9]{1,5}|S/N)$'

/** Patrón de `PostalCode`: `1414`, `B1900` o `C1414ABC`. */
const POSTAL_CODE_PATTERN = '^[A-Za-z]?[0-9]{4}[A-Za-z]{0,3}$'

/** `Máximo <max> caracteres`, como `MESSAGES.max` del front. */
function maxMessage(max: number): string {
  return `Máximo ${String(max)} caracteres`
}

/**
 * Valor crudo del JSON recortado (con `upper`, además en mayúsculas); si no es texto queda como
 * vino y la validación lo rechaza.
 */
function Trimmed(upper = false): PropertyDecorator {
  return Transform(({ obj, key }) => {
    const value = (obj as Record<string, unknown>)[key]
    if (typeof value !== 'string') return value
    return upper ? value.trim().toUpperCase() : value.trim()
  })
}

/**
 * Rechaza (422, "Ingresá un texto") un texto que Postgres no guarda tal cual: sin esto el pedido
 * fallaba con 500 después de tomar su número (NV-15). Ver {@link StorableText}.
 */
function StorableAddressText(): PropertyDecorator {
  return StorableText(ADDRESS_MESSAGES.invalidText)
}

// class-validator corre los decoradores de abajo hacia arriba: el tipo va último (abajo) para que
// el primer error de cada campo sea el mismo que el del schema de zod del front.

/**
 * Dirección de domicilio (`AddressInput` del contrato): la comparten la libreta de direcciones
 * (`AddressBookInputDto` de identidad la extiende) y el envío a domicilio del checkout. Swagger la
 * publica con este nombre.
 */
@ApiSchema({ name: 'AddressInput' })
export class AddressInputDto {
  /** Calle, recortada (de 2 a 80 caracteres). */
  @ApiProperty({ type: 'string', minLength: 2, maxLength: 80 })
  @Trimmed()
  @StorableAddressText()
  @MaxLength(80, { message: maxMessage(80) })
  @MinLength(2, { message: ADDRESS_MESSAGES.required })
  @IsString({ message: ADDRESS_MESSAGES.required })
  street!: string

  /** Número de 1 a 5 dígitos o `S/N`, en mayúsculas. */
  @ApiProperty({ type: 'string', pattern: STREET_NUMBER_PATTERN })
  @Trimmed(true)
  @Matches(new RegExp(STREET_NUMBER_PATTERN), { message: ADDRESS_MESSAGES.invalidStreetNumber })
  @IsNotEmpty({ message: ADDRESS_MESSAGES.required })
  @IsString({ message: ADDRESS_MESSAGES.required })
  number!: string

  /** Piso o departamento (hasta 10 caracteres), o `null`; si falta o queda vacío, `null`. */
  @ApiProperty({ type: 'string', nullable: true, maxLength: 10 })
  @Trimmed()
  @IsOptional()
  @StorableAddressText()
  @MaxLength(10, { message: maxMessage(10) })
  @IsString({ message: ADDRESS_MESSAGES.invalidText })
  apartment?: string | null

  /** Código postal argentino, en mayúsculas. */
  @ApiSchemaProperty(namedRef('PostalCode'))
  @Trimmed(true)
  @Matches(new RegExp(POSTAL_CODE_PATTERN), { message: ADDRESS_MESSAGES.invalidPostalCode })
  @IsString({ message: ADDRESS_MESSAGES.invalidPostalCode })
  postalCode!: string

  /** Ciudad o localidad, recortada (de 2 a 60 caracteres). */
  @ApiProperty({ type: 'string', minLength: 2, maxLength: 60 })
  @Trimmed()
  @StorableAddressText()
  @MaxLength(60, { message: maxMessage(60) })
  @MinLength(2, { message: ADDRESS_MESSAGES.required })
  @IsString({ message: ADDRESS_MESSAGES.required })
  city!: string

  /** Provincia: una de las 24 del contrato, con acentos y mayúsculas exactos. */
  @ApiSchemaProperty(namedRef('Province'))
  @IsIn(PROVINCES, { message: ADDRESS_MESSAGES.invalidProvince })
  province!: Province
}
