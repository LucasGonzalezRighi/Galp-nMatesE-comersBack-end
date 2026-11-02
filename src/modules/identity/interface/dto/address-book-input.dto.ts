import { ApiProperty, ApiSchema } from '@nestjs/swagger'
import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator'

import type { AddressInput } from '../../domain/address.entity'
import { type Province, PROVINCES } from '../../domain/province'
import { ApiSchemaProperty, namedRef } from '../../../../shared/infrastructure/http/openapi'
import {
  IDENTITY_MESSAGES,
  maxMessage,
  POSTAL_CODE_PATTERN,
  RawValue,
  STREET_NUMBER_PATTERN,
  Trimmed,
} from './identity-fields'

// class-validator corre los decoradores de abajo hacia arriba: el tipo va último (abajo) para que
// el primer error de cada campo sea el mismo que el del schema de zod del front.

/**
 * Dirección de domicilio (`AddressInput` del contrato): la parte de la libreta que comparte con el
 * envío a domicilio del checkout. Swagger la publica con este nombre y `AddressBookInput` la
 * referencia.
 */
@ApiSchema({ name: 'AddressInput' })
export class AddressInputDto {
  /** Calle, recortada (de 2 a 80 caracteres). */
  @ApiProperty({ type: 'string', minLength: 2, maxLength: 80 })
  @Trimmed()
  @MaxLength(80, { message: maxMessage(80) })
  @MinLength(2, { message: IDENTITY_MESSAGES.required })
  @IsString({ message: IDENTITY_MESSAGES.required })
  street!: string

  /** Número de 1 a 5 dígitos o `S/N`, en mayúsculas. */
  @ApiProperty({ type: 'string', pattern: STREET_NUMBER_PATTERN })
  @Trimmed('upper')
  @Matches(new RegExp(STREET_NUMBER_PATTERN), { message: IDENTITY_MESSAGES.invalidStreetNumber })
  @IsNotEmpty({ message: IDENTITY_MESSAGES.required })
  @IsString({ message: IDENTITY_MESSAGES.required })
  number!: string

  /** Piso o departamento (hasta 10 caracteres), o `null`; si falta o queda vacío, `null`. */
  @ApiProperty({ type: 'string', nullable: true, maxLength: 10 })
  @Trimmed()
  @IsOptional()
  @MaxLength(10, { message: maxMessage(10) })
  @IsString({ message: IDENTITY_MESSAGES.invalidText })
  apartment?: string | null

  /** Código postal argentino, en mayúsculas. */
  @ApiSchemaProperty(namedRef('PostalCode'))
  @Trimmed('upper')
  @Matches(new RegExp(POSTAL_CODE_PATTERN), { message: IDENTITY_MESSAGES.invalidPostalCode })
  @IsString({ message: IDENTITY_MESSAGES.invalidPostalCode })
  postalCode!: string

  /** Ciudad o localidad, recortada (de 2 a 60 caracteres). */
  @ApiProperty({ type: 'string', minLength: 2, maxLength: 60 })
  @Trimmed()
  @MaxLength(60, { message: maxMessage(60) })
  @MinLength(2, { message: IDENTITY_MESSAGES.required })
  @IsString({ message: IDENTITY_MESSAGES.required })
  city!: string

  /** Provincia: una de las 24 del contrato, con acentos y mayúsculas exactos. */
  @ApiSchemaProperty(namedRef('Province'))
  @IsIn(PROVINCES, { message: IDENTITY_MESSAGES.invalidProvince })
  province!: Province
}

/**
 * Cuerpo de `POST /me/addresses` y `PATCH /me/addresses/{id}` (`AddressBookInput` del contrato:
 * la dirección completa, la etiqueta y si es la predeterminada). Swagger usa el esquema crudo
 * `IDENTITY_OPENAPI_SCHEMAS.AddressBookInput` (un `allOf` con `AddressInput`).
 */
export class AddressBookInputDto extends AddressInputDto {
  /** Nombre con el que el cliente la reconoce (hasta 30 caracteres), o `null`. */
  @Trimmed()
  @IsOptional()
  @MaxLength(30, { message: maxMessage(30) })
  @IsString({ message: IDENTITY_MESSAGES.invalidText })
  label?: string | null

  /** Si es la predeterminada: solo un booleano de JSON (`"false"` responde 422). */
  @RawValue()
  @IsBoolean({ message: IDENTITY_MESSAGES.invalidDefault })
  isDefault!: boolean

  /**
   * La dirección para los casos de uso: la etiqueta y el departamento que faltan pasan a `null`
   * (el dominio además pasa a `null` los que quedaron vacíos).
   *
   * @returns La dirección completa.
   */
  toInput(): AddressInput {
    return {
      label: this.label ?? null,
      street: this.street,
      number: this.number,
      apartment: this.apartment ?? null,
      postalCode: this.postalCode,
      city: this.city,
      province: this.province,
      isDefault: this.isDefault,
    }
  }
}
