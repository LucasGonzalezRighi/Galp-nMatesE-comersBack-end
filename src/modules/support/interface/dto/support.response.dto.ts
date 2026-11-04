// DTOs de respuesta de la bandeja, solo para Swagger: reproducen `ContactMessage`,
// `ContactMessagePage` y `WithdrawalReceipt` del contrato, y el test de contrato los compara. Nunca
// se instancian (los controladores devuelven los read models de `application`).

import { ApiSchema } from '@nestjs/swagger'

import {
  ApiSchemaProperty,
  namedRef,
  nullableRef,
  type OpenApiSchema,
  schemaRef,
} from '../../../../shared/infrastructure/http/openapi'
import { CONTACT_MESSAGE_KINDS, CONTACT_REASONS } from '../../domain/contact-message'

/** Mensaje de la bandeja (`ContactMessage`). */
@ApiSchema({ name: 'ContactMessage' })
export class ContactMessageDto {
  /** Id. */
  @ApiSchemaProperty({ type: 'string' })
  id!: string

  /** Tipo de mensaje. */
  @ApiSchemaProperty(namedRef('ContactMessageKind'))
  kind!: string

  /** Nombre de quien escribió. */
  @ApiSchemaProperty({ type: 'string' })
  name!: string

  /** Email. */
  @ApiSchemaProperty(namedRef('Email'))
  email!: string

  /** Número de pedido, o `null`. */
  @ApiSchemaProperty(nullableRef('OrderNumber'))
  orderNumber!: string | null

  /** Motivo, o `null` en un arrepentimiento. */
  @ApiSchemaProperty(nullableRef('ContactReason'))
  reason!: string | null

  /** Texto, o `null`. */
  @ApiSchemaProperty({ type: 'string', nullable: true })
  message!: string | null

  /** Código de comprobante, o `null`. */
  @ApiSchemaProperty({ type: 'string', nullable: true })
  code!: string | null

  /** Cuándo llegó, en UTC. */
  @ApiSchemaProperty({ type: 'string', format: 'date-time' })
  createdAt!: string

  /** Si ya se leyó. */
  @ApiSchemaProperty({ type: 'boolean' })
  read!: boolean
}

/** Página de la bandeja (`ContactMessagePage`). */
@ApiSchema({ name: 'ContactMessagePage' })
export class ContactMessagePageDto {
  /** Mensajes de la página. */
  @ApiSchemaProperty({ type: 'array', items: schemaRef('ContactMessage') })
  items!: ContactMessageDto[]

  /** Número de página, desde 1. */
  @ApiSchemaProperty({ type: 'integer', minimum: 1 })
  page!: number

  /** Mensajes por página. */
  @ApiSchemaProperty({ type: 'integer', minimum: 1, maximum: 100 })
  pageSize!: number

  /** Total de mensajes que cumplen los filtros. */
  @ApiSchemaProperty({ type: 'integer', minimum: 0 })
  total!: number
}

/** Comprobante de un arrepentimiento (`WithdrawalReceipt`). */
@ApiSchema({ name: 'WithdrawalReceipt' })
export class WithdrawalReceiptDto {
  /** Código de comprobante. */
  @ApiSchemaProperty({ type: 'string', minLength: 1, maxLength: 40 })
  code!: string
}

/** Enums de la bandeja con su nombre del contrato. `buildOpenApiDocument` los suma. */
export const SUPPORT_OPENAPI_SCHEMAS: Readonly<Record<string, OpenApiSchema>> = {
  ContactMessageKind: { type: 'string', enum: [...CONTACT_MESSAGE_KINDS] },
  ContactReason: { type: 'string', enum: [...CONTACT_REASONS] },
}
