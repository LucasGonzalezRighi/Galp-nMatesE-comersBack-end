// DTOs de respuesta de identidad, solo para Swagger: reproducen `components/schemas` del contrato
// (`Customer`, `CsrfToken`, `AdminLoginResult` y `AdminSession`) y el test de contrato los
// compara. Nunca se instancian (los controladores devuelven los read models de `application`): los
// campos van con asignación definida (`!`).

import { ApiProperty, ApiSchema, getSchemaPath } from '@nestjs/swagger'

import {
  ApiSchemaProperty,
  namedRef,
  nullableRef,
  type OpenApiSchema,
  schemaRef,
} from '../../../../shared/infrastructure/http/openapi'
import { PROVINCES } from '../../domain/province'
import { AddressInputDto } from './address-book-input.dto'
import {
  EMAIL_MAX_LENGTH,
  PASSWORD_MAX_LENGTH,
  PASSWORD_PATTERN,
  PERSON_NAME_PATTERN,
  PHONE_PATTERN,
  POSTAL_CODE_PATTERN,
} from './identity-fields'

/** Datos de un cliente (`Customer`). */
@ApiSchema({ name: 'Customer' })
export class CustomerDto {
  /** Email normalizado. */
  @ApiSchemaProperty(namedRef('Email'))
  email!: string

  /** Nombre. */
  @ApiSchemaProperty(namedRef('PersonName'))
  firstName!: string

  /** Apellido. */
  @ApiSchemaProperty(namedRef('PersonName'))
  lastName!: string

  /** Teléfono, o `null`. */
  @ApiSchemaProperty(nullableRef('Phone'))
  phone!: string | null
}

/** Token anti-CSRF (`CsrfToken`). */
@ApiSchema({ name: 'CsrfToken' })
export class CsrfTokenDto {
  /** Token que va en `X-CSRF-Token`, ligado a la sesión actual. */
  @ApiProperty({ type: 'string', minLength: 1 })
  csrfToken!: string
}

/** Sesión del dashboard recién iniciada (`AdminLoginResult`). */
@ApiSchema({ name: 'AdminLoginResult' })
export class AdminLoginResultDto {
  /** Email del admin. */
  @ApiSchemaProperty(namedRef('Email'))
  email!: string

  /** Token anti-CSRF de la sesión nueva. */
  @ApiProperty({ type: 'string', minLength: 1 })
  csrfToken!: string

  /** Cuándo vence la sesión (UTC). */
  @ApiProperty({ type: 'string', format: 'date-time' })
  expiresAt!: string
}

/** Sesión activa del dashboard (`AdminSession`). */
@ApiSchema({ name: 'AdminSession' })
export class AdminSessionDto {
  /** Email del admin. */
  @ApiSchemaProperty(namedRef('Email'))
  email!: string

  /** Cuándo vence la sesión (UTC). */
  @ApiProperty({ type: 'string', format: 'date-time' })
  expiresAt!: string
}

/**
 * Esquemas de identidad que no salen de una clase: los campos con nombre (`Email`, `PersonName`,
 * `Phone`, `PostalCode`, `Province`, `Password`), `CustomerUpdate` (con `minProperties`) y las
 * direcciones (`allOf`). Los de pedidos (`OrderNumber`, `OrderStatus`, `PaymentStatus`,
 * `TotalArs`) los publica `orders` desde B4.
 * `buildOpenApiDocument` los suma a `components.schemas`.
 */
export const IDENTITY_OPENAPI_SCHEMAS: Readonly<Record<string, OpenApiSchema>> = {
  Email: { type: 'string', format: 'email', maxLength: EMAIL_MAX_LENGTH },
  PersonName: { type: 'string', minLength: 2, maxLength: 50, pattern: PERSON_NAME_PATTERN },
  Phone: { type: 'string', pattern: PHONE_PATTERN },
  PostalCode: { type: 'string', pattern: POSTAL_CODE_PATTERN },
  Province: { type: 'string', enum: [...PROVINCES] },
  Password: {
    type: 'string',
    minLength: 10,
    maxLength: PASSWORD_MAX_LENGTH,
    pattern: PASSWORD_PATTERN,
  },
  CustomerUpdate: {
    type: 'object',
    minProperties: 1,
    properties: {
      firstName: schemaRef('PersonName'),
      lastName: schemaRef('PersonName'),
      phone: nullableRef('Phone'),
    },
  },
  AddressBookInput: {
    allOf: [
      { $ref: getSchemaPath(AddressInputDto) },
      {
        type: 'object',
        required: ['label', 'isDefault'],
        properties: {
          label: { type: ['string', 'null'], maxLength: 30 },
          isDefault: { type: 'boolean' },
        },
      },
    ],
  },
  Address: {
    allOf: [
      schemaRef('AddressBookInput'),
      { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
    ],
  },
}
