// DTOs de respuesta de pagos, solo para Swagger: reproducen `MercadoPagoPreference`,
// `CardPaymentResult` e `InstallmentOption` del contrato y el test de contrato los compara. Nunca
// se instancian (los controladores devuelven los read models de `application`). El cuerpo del
// webhook (`MercadoPagoWebhookEvent`) no sale de una clase: el controlador lo lee sin DTO para no
// rechazar los campos de más de Mercado Pago, así que su esquema está en `PAYMENTS_OPENAPI_SCHEMAS`.

import { ApiProperty, ApiSchema } from '@nestjs/swagger'

import {
  ApiSchemaProperty,
  namedRef,
  nullableRef,
  type OpenApiSchema,
} from '../../../../shared/infrastructure/http/openapi'

/** Preferencia de Checkout Pro creada (`MercadoPagoPreference`). */
@ApiSchema({ name: 'MercadoPagoPreference' })
export class MercadoPagoPreferenceDto {
  /** Dirección a la que la tienda redirige para pagar. */
  @ApiProperty({ type: 'string', format: 'uri' })
  initPoint!: string
}

/** Resultado de un intento de pago con tarjeta (`CardPaymentResult`). */
@ApiSchema({ name: 'CardPaymentResult' })
export class CardPaymentResultDto {
  /** Estado del pago en este momento. */
  @ApiSchemaProperty(namedRef('PaymentStatus'))
  paymentStatus!: string

  /** `status_detail` de Mercado Pago, o `null`. */
  @ApiSchemaProperty({ type: 'string', nullable: true })
  statusDetail!: string | null

  /** Desafío 3-D Secure pendiente, o `null`. */
  @ApiSchemaProperty(nullableRef('PaymentChallenge'))
  challenge!: unknown
}

/** Opción de cuotas para una tarjeta (`InstallmentOption`). */
@ApiSchema({ name: 'InstallmentOption' })
export class InstallmentOptionDto {
  /** Cantidad de cuotas (1 es un solo pago). */
  @ApiProperty({ type: 'integer', minimum: 1, maximum: 24 })
  installments!: number

  /** Importe de cada cuota, en pesos. */
  @ApiSchemaProperty(namedRef('TotalArs'))
  installmentAmountArs!: number

  /** Total con el costo financiero incluido. */
  @ApiSchemaProperty(namedRef('TotalArs'))
  totalArs!: number

  /** Costo financiero total, en porcentaje (0 sin interés). */
  @ApiProperty({ type: 'number', minimum: 0, maximum: 1000 })
  cftPercent!: number

  /** Tasa efectiva anual, en porcentaje (0 sin interés). */
  @ApiProperty({ type: 'number', minimum: 0, maximum: 1000 })
  teaPercent!: number

  /** Texto informativo de la opción. */
  @ApiProperty({ type: 'string', minLength: 1, maxLength: 200 })
  label!: string
}

/**
 * Esquemas de pagos que no salen de una clase: la notificación de Mercado Pago, que conserva su
 * formato (`snake_case`) y puede traer más campos. `buildOpenApiDocument` los suma a
 * `components.schemas`.
 */
export const PAYMENTS_OPENAPI_SCHEMAS: Readonly<Record<string, OpenApiSchema>> = {
  MercadoPagoWebhookEvent: {
    type: 'object',
    required: ['type', 'data'],
    properties: {
      type: { type: 'string' },
      action: { type: 'string' },
      data: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
    },
  },
}
