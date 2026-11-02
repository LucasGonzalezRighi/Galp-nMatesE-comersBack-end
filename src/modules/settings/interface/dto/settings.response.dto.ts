// DTOs de respuesta de los ajustes públicos, solo para Swagger: reproducen `ShippingOption` y
// `PublicSettings` del contrato, y el test de contrato los compara. Nunca se instancian (el
// controlador devuelve el read model de `application`): los campos van con asignación definida
// (`!`), como dice el README.

import { ApiProperty, ApiSchema } from '@nestjs/swagger'

import {
  ApiSchemaProperty,
  namedRef,
  type OpenApiSchema,
} from '../../../../shared/infrastructure/http/openapi'
import { SHIPPING_METHODS } from '../../domain/store-settings.entity'

/** Texto o `null`, con largo máximo (dentro de un objeto en línea). */
function nullableText(maxLength: number): OpenApiSchema {
  return { type: ['string', 'null'], maxLength }
}

/** Opción de envío (`ShippingOption`). */
@ApiSchema({ name: 'ShippingOption' })
export class ShippingOptionDto {
  /** Método. */
  @ApiProperty({ enum: [...SHIPPING_METHODS], enumName: 'ShippingMethod' })
  method!: string

  /** Nombre visible. */
  @ApiProperty({ type: 'string' })
  label!: string

  /** Costo en pesos. */
  @ApiSchemaProperty(namedRef('Pesos'))
  costArs!: number

  /** Plazo estimado. */
  @ApiProperty({ type: 'string' })
  eta!: string

  /** Si la tienda lo ofrece. */
  @ApiProperty({ type: 'boolean' })
  enabled!: boolean
}

/** Ajustes que necesita la tienda (`PublicSettings`). */
@ApiSchema({ name: 'PublicSettings' })
export class PublicSettingsDto {
  /** Descuento del kit, en porcentaje. */
  @ApiProperty({ type: 'integer', minimum: 0, maximum: 30 })
  kitDiscountPercent!: number

  /** Las tres opciones de envío. */
  @ApiProperty({ type: () => ShippingOptionDto, isArray: true, minItems: 3, maxItems: 3 })
  shippingOptions!: ShippingOptionDto[]

  /** Cuotas sin interés. */
  @ApiSchemaProperty({
    type: 'object',
    required: ['maxWithoutInterest', 'showOnProduct'],
    properties: {
      maxWithoutInterest: { type: 'integer', minimum: 1, maximum: 12 },
      showOnProduct: { type: 'boolean' },
    },
  })
  installments!: unknown

  /** Mail de contacto. */
  @ApiProperty({ type: 'string', format: 'email' })
  contactEmail!: string

  /** Cómo se muestra el precio. */
  @ApiSchemaProperty({
    type: 'object',
    required: ['showNetPrice'],
    properties: { showNetPrice: { type: 'boolean' } },
  })
  priceDisplay!: unknown

  /** Datos del vendedor (cada uno `null` si no está cargado). */
  @ApiSchemaProperty({
    type: 'object',
    required: [
      'legalName',
      'cuit',
      'taxCondition',
      'address',
      'phone',
      'supportArea',
      'supportHours',
      'dataFiscalUrl',
    ],
    properties: {
      legalName: nullableText(120),
      cuit: { type: ['string', 'null'], pattern: '^[0-9]{11}$' },
      taxCondition: nullableText(60),
      address: nullableText(200),
      phone: nullableText(60),
      supportArea: nullableText(80),
      supportHours: nullableText(120),
      dataFiscalUrl: {
        type: ['string', 'null'],
        format: 'uri',
        maxLength: 2048,
        pattern: '^https?://',
      },
    },
  })
  seller!: unknown
}
