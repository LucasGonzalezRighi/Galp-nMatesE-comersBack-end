import { IsOptional, IsString, Matches, ValidateIf } from 'class-validator'

import type { CustomerPatch } from '../../application/ports/customer.repository.port'
import { IDENTITY_MESSAGES, PersonNameRules, PHONE_PATTERN, RawValue } from './identity-fields'

/** Deja validar el campo solo si vino (un `null` en un nombre sí se valida y falla). */
const IF_PRESENT = (_object: object, value: unknown): boolean => value !== undefined

/**
 * Cuerpo de `PATCH /me` (`CustomerUpdate` del contrato). Solo cambian los campos que vienen;
 * `phone: null` borra el teléfono. Que venga al menos uno lo revisa el controlador (el esquema de
 * Swagger, con `minProperties: 1`, es `IDENTITY_OPENAPI_SCHEMAS.CustomerUpdate`).
 */
export class CustomerUpdateDto {
  /** Nombre nuevo, recortado. */
  @ValidateIf(IF_PRESENT)
  @PersonNameRules()
  firstName?: string

  /** Apellido nuevo, recortado. */
  @ValidateIf(IF_PRESENT)
  @PersonNameRules()
  lastName?: string

  /** Teléfono nuevo (10 dígitos, ya normalizado por la tienda), o `null` para borrarlo. */
  @IsOptional()
  @RawValue()
  @Matches(new RegExp(PHONE_PATTERN), { message: IDENTITY_MESSAGES.invalidPhone })
  @IsString({ message: IDENTITY_MESSAGES.invalidPhone })
  phone?: string | null

  /**
   * Los cambios para el caso de uso (los que no vinieron quedan `undefined`).
   *
   * @returns El `CustomerPatch` con nombre, apellido y teléfono.
   */
  toPatch(): CustomerPatch {
    return { firstName: this.firstName, lastName: this.lastName, phone: this.phone }
  }

  /**
   * Indica si no vino ningún cambio (cuerpo `{}`).
   *
   * @returns `true` si los tres campos faltan.
   */
  isEmpty(): boolean {
    return this.firstName === undefined && this.lastName === undefined && this.phone === undefined
  }
}
