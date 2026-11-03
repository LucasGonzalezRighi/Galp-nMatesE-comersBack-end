import { ApiSchema } from '@nestjs/swagger'
import { Expose, Transform, type TransformFnParams } from 'class-transformer'
import { IsString, Matches, ValidateIf } from 'class-validator'

import {
  EmailField,
  IDENTITY_MESSAGES,
  PersonNameField,
  PHONE_PATTERN,
} from '../../../identity/interface/dto/identity-fields'
import { ApiSchemaProperty, nullableRef } from '../../../../shared/infrastructure/http/openapi'
import type { OrderContact } from '../../domain/order.entity'

/** Prefijos del país en un teléfono, el más largo primero (`COUNTRY_PREFIXES` del front). */
const COUNTRY_PREFIXES = ['549', '54'] as const

/**
 * Normaliza un teléfono como `optionalPhoneSchema` del front: recorta, quita todo lo que no es
 * dígito y el prefijo del país (`549` o `54`) solo si quedan exactamente 10 dígitos. Vacío,
 * ausente o `null` quedan `null`; un valor que no es texto queda como vino (la validación lo
 * rechaza).
 */
function toPhone({ obj, key }: TransformFnParams): unknown {
  const raw = (obj as Record<string, unknown>)[key]
  if (raw === undefined || raw === null) return null
  if (typeof raw !== 'string') return raw
  const trimmed = raw.trim()
  if (trimmed === '') return null
  const digits = trimmed.replace(/\D/g, '')
  const prefix = COUNTRY_PREFIXES.find((candidate) => digits.startsWith(candidate))
  if (prefix === undefined) return digits
  const national = digits.slice(prefix.length)
  return national.length === 10 ? national : digits
}

/**
 * Contacto de quien compra (`CustomerInput` del contrato), con las reglas y los mensajes de
 * `checkoutContactSchema` del front: email recortado y en minúsculas, nombre y apellido de 2 a 50
 * letras, y teléfono opcional normalizado a 10 dígitos (vacío, ausente o `null` quedan `null`).
 */
@ApiSchema({ name: 'CustomerInput' })
export class CustomerInputDto {
  /** Email, recortado y en minúsculas. */
  @EmailField()
  email!: string

  /** Nombre, recortado. */
  @PersonNameField()
  firstName!: string

  /** Apellido, recortado. */
  @PersonNameField()
  lastName!: string

  /** Teléfono de 10 dígitos, o `null` si no lo cargó. */
  @ApiSchemaProperty(nullableRef('Phone'))
  @Expose()
  @Transform(toPhone)
  @ValidateIf((_object, value) => value !== null)
  @Matches(new RegExp(PHONE_PATTERN), { message: IDENTITY_MESSAGES.invalidPhone })
  @IsString({ message: IDENTITY_MESSAGES.invalidPhone })
  phone!: string | null

  /**
   * El contacto para `CreateOrderCommand`.
   *
   * @returns Email, nombre, apellido y teléfono (o `null`).
   */
  toContact(): OrderContact {
    return {
      email: this.email,
      firstName: this.firstName,
      lastName: this.lastName,
      phone: this.phone,
    }
  }
}
