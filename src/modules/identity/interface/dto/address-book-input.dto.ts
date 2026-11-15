import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator'

import type { AddressInput } from '../../domain/address.entity'
import { AddressInputDto } from '../../../../shared/infrastructure/http/address-input.dto'
import { StorableText } from '../../../../shared/infrastructure/http/storable-text.validator'
import { IDENTITY_MESSAGES, maxMessage, RawValue, Trimmed } from './identity-fields'

// `AddressInputDto` se mudó a `src/shared/infrastructure/http/address-input.dto.ts` (también la usa
// el checkout de `orders`); se re-exporta para no tocar los controladores de identidad.
export { AddressInputDto }

/**
 * Cuerpo de `POST /me/addresses` y `PATCH /me/addresses/{id}` (`AddressBookInput` del contrato:
 * la dirección completa, la etiqueta y si es la predeterminada). Swagger usa el esquema crudo
 * `IDENTITY_OPENAPI_SCHEMAS.AddressBookInput` (un `allOf` con `AddressInput`).
 */
export class AddressBookInputDto extends AddressInputDto {
  /**
   * Nombre con el que el cliente la reconoce (hasta 30 caracteres, que Postgres pueda guardar), o
   * `null`.
   */
  @Trimmed()
  @IsOptional()
  @StorableText(IDENTITY_MESSAGES.invalidText)
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
