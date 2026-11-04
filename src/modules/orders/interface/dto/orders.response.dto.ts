// DTOs de respuesta de pedidos, solo para Swagger: reproducen `components/schemas` del contrato
// (`CartQuote`, `CartQuoteLine`, `ShippingQuote`, `CreateOrderResult`, `Order` y sus partes,
// `OrderSummary` y `OrderSummaryPage`) y el test de contrato los compara. Nunca se instancian (los
// controladores devuelven los read models de `application`): los campos van con asignación
// definida (`!`). Los esquemas que no salen de una clase (enums, escalares con nombre, las líneas
// del carrito con su `discriminator` y los destinos con `oneOf`) están en `ORDERS_OPENAPI_SCHEMAS`.

import { ApiProperty, ApiSchema } from '@nestjs/swagger'

import { CustomerDto } from '../../../identity/interface/dto/identity.response.dto'
import {
  ApiSchemaProperty,
  namedRef,
  nullableRef,
  type OpenApiSchema,
  schemaRef,
} from '../../../../shared/infrastructure/http/openapi'
import { ADMIN_ORDER_TARGETS } from '../../domain/admin-order-transitions'
import { ORDER_NUMBER_PATTERN } from '../../domain/order-number'
import {
  LINE_TYPES,
  ORDER_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
} from '../../domain/order-status'
import { MAX_TOTAL_ARS } from '../../domain/pricing'

/** Problemas posibles de una línea cotizada (`CartQuoteLine.issue`, sin el `null`). */
const LINE_ISSUES = ['unavailable', 'sold_out', 'quantity_reduced', 'price_changed'] as const

/** Fecha y hora en UTC. */
const DATE_TIME: OpenApiSchema = { type: 'string', format: 'date-time' }

/** Texto o `null` en la raíz de una propiedad (`@ApiProperty` lo pasa a `type: [string, null]`). */
const NULLABLE_STRING: OpenApiSchema = { type: 'string', nullable: true }

/** Línea cotizada (`CartQuoteLine`). */
@ApiSchema({ name: 'CartQuoteLine' })
export class CartQuoteLineDto {
  /** Clave de la línea, igual a la de la tienda. */
  @ApiProperty({ type: 'string' })
  key!: string

  /** Producto suelto, kit o combo. */
  @ApiSchemaProperty(namedRef('LineType'))
  type!: string

  /** Nombre del producto, `Kit` o el nombre del combo. */
  @ApiProperty({ type: 'string' })
  name!: string

  /** Opciones elegidas; vacío si no hay. */
  @ApiProperty({ type: 'string' })
  detail!: string

  /** Precio de lista de una unidad. */
  @ApiSchemaProperty(namedRef('TotalArs'))
  unitPriceArs!: number

  /** Neto de una unidad, o `null` si no se muestran los netos. */
  @ApiSchemaProperty(nullableRef('TotalArs'))
  netUnitPriceArs!: number | null

  /** Ahorro por kit o por combo de la línea. */
  @ApiSchemaProperty(namedRef('TotalArs'))
  kitSavingsArs!: number

  /** Importe de la línea. */
  @ApiSchemaProperty(namedRef('TotalArs'))
  totalArs!: number

  /** Máximo que se puede pedir de la línea. */
  @ApiProperty({ type: 'integer', minimum: 0, maximum: 20 })
  maxQuantity!: number

  /** Problema de la línea, o `null`. */
  @ApiSchemaProperty({ type: 'string', nullable: true, enum: [...LINE_ISSUES] })
  issue!: string | null
}

/** Cotización del carrito (`CartQuote`). */
@ApiSchema({ name: 'CartQuote' })
export class CartQuoteDto {
  /** Líneas en el orden del carrito. */
  @ApiProperty({ type: () => [CartQuoteLineDto] })
  lines!: CartQuoteLineDto[]

  /** Suma de los precios de lista. */
  @ApiSchemaProperty(namedRef('TotalArs'))
  itemsGrossArs!: number

  /** Suma de los ahorros por kit y por combo. */
  @ApiSchemaProperty(namedRef('TotalArs'))
  kitSavingsArs!: number

  /** Bruto menos los ahorros por kit y por combo. */
  @ApiSchemaProperty(namedRef('TotalArs'))
  subtotalArs!: number

  /** Neto del subtotal, o `null`. */
  @ApiSchemaProperty(nullableRef('TotalArs'))
  netSubtotalArs!: number | null
}

/** Costo y plazo de un envío (`ShippingQuote`). */
@ApiSchema({ name: 'ShippingQuote' })
export class ShippingQuoteDto {
  /** Método. */
  @ApiSchemaProperty(namedRef('ShippingMethod'))
  method!: string

  /** Costo en pesos. */
  @ApiSchemaProperty(namedRef('Pesos'))
  costArs!: number

  /** Plazo estimado. */
  @ApiProperty({ type: 'string' })
  eta!: string
}

/** Envío de un pedido (`OrderShipping`). */
@ApiSchema({ name: 'OrderShipping' })
export class OrderShippingDto {
  /** Método. */
  @ApiSchemaProperty(namedRef('ShippingMethod'))
  method!: string

  /** Destino, o `null` en el retiro. */
  @ApiSchemaProperty(nullableRef('ShippingAddress'))
  address!: unknown

  /** Costo al comprar. */
  @ApiSchemaProperty(namedRef('Pesos'))
  costArs!: number

  /** Plazo al comprar. */
  @ApiProperty({ type: 'string' })
  eta!: string
}

/** Línea de un pedido (`OrderLine`). */
@ApiSchema({ name: 'OrderLine' })
export class OrderLineDto {
  /** Producto suelto, kit o combo. */
  @ApiSchemaProperty(namedRef('LineType'))
  type!: string

  /** Nombre del producto, `Kit` o el nombre del combo. */
  @ApiProperty({ type: 'string' })
  name!: string

  /** Opciones elegidas; vacío si no hay. */
  @ApiProperty({ type: 'string' })
  detail!: string

  /** Unidades compradas. */
  @ApiProperty({ type: 'integer', minimum: 1, maximum: 20 })
  quantity!: number

  /** Precio de lista de una unidad. */
  @ApiSchemaProperty(namedRef('TotalArs'))
  unitPriceArs!: number

  /** Ahorro por kit o por combo de la línea. */
  @ApiSchemaProperty(namedRef('TotalArs'))
  kitSavingsArs!: number

  /** Importe de la línea. */
  @ApiSchemaProperty(namedRef('TotalArs'))
  totalArs!: number

  /** Slug del producto al comprar, o `null` en un kit o un combo. */
  @ApiSchemaProperty(NULLABLE_STRING)
  productSlug!: string | null

  /** Cuero y virola de un mate, de un kit o del mate de un combo, o `null`. */
  @ApiSchemaProperty(nullableRef('CartItemOptions'))
  options!: unknown

  /** Las piezas de un kit (3) o de un combo (2 o 3, en el orden del combo), o `null`. */
  @ApiSchemaProperty({
    type: 'array',
    nullable: true,
    minItems: 2,
    maxItems: 3,
    items: {
      type: 'object',
      required: ['slug', 'name', 'unitPriceArs'],
      properties: {
        slug: { type: 'string' },
        name: { type: 'string' },
        unitPriceArs: schemaRef('Pesos'),
      },
    },
  })
  kitItems!: unknown
}

/** Verificación 3-D Secure pendiente (`PaymentChallenge`). */
@ApiSchema({ name: 'PaymentChallenge' })
export class PaymentChallengeDto {
  /** Dirección de la verificación. */
  @ApiProperty({ type: 'string', format: 'uri' })
  url!: string
}

/** Pago de un pedido (`OrderPayment`). */
@ApiSchema({ name: 'OrderPayment' })
export class OrderPaymentDto {
  /** Forma de pago. */
  @ApiSchemaProperty(namedRef('PaymentMethod'))
  method!: string

  /** Cuotas, o `null`. */
  @ApiSchemaProperty({ type: 'integer', nullable: true, minimum: 1, maximum: 24 })
  installments!: number | null

  /** Tipo de medio de pago de Mercado Pago, o `null`. */
  @ApiSchemaProperty(NULLABLE_STRING)
  paymentTypeId!: string | null

  /** Últimos cuatro dígitos, o `null`. */
  @ApiSchemaProperty({ type: 'string', nullable: true, pattern: '^[0-9]{4}$' })
  lastFour!: string | null

  /** Detalle del estado de Mercado Pago, o `null`. */
  @ApiSchemaProperty(NULLABLE_STRING)
  statusDetail!: string | null

  /** Id del pago en Mercado Pago, o `null`. */
  @ApiSchemaProperty(NULLABLE_STRING)
  mpPaymentId!: string | null

  /** Verificación pendiente, o `null`. */
  @ApiSchemaProperty(nullableRef('PaymentChallenge'))
  challenge!: unknown
}

/** Datos del despacho (`OrderTracking`). */
@ApiSchema({ name: 'OrderTracking' })
export class OrderTrackingDto {
  /** Empresa de transporte. */
  @ApiProperty({ type: 'string', minLength: 2, maxLength: 40 })
  carrier!: string

  /** Número de seguimiento. */
  @ApiProperty({ type: 'string', minLength: 4, maxLength: 40 })
  number!: string
}

/** Cambio de estado (`OrderHistoryEntry`). */
@ApiSchema({ name: 'OrderHistoryEntry' })
export class OrderHistoryEntryDto {
  /** Estado nuevo. */
  @ApiSchemaProperty(namedRef('OrderStatus'))
  status!: string

  /** Momento del cambio (UTC). */
  @ApiSchemaProperty(DATE_TIME)
  at!: string

  /** Nota, o `null`. */
  @ApiSchemaProperty(NULLABLE_STRING)
  note!: string | null
}

/** Pedido (`Order`). */
@ApiSchema({ name: 'Order' })
export class OrderDto {
  /** Número de pedido. */
  @ApiSchemaProperty(namedRef('OrderNumber'))
  number!: string

  /** Estado. */
  @ApiSchemaProperty(namedRef('OrderStatus'))
  status!: string

  /** Estado del pago. */
  @ApiSchemaProperty(namedRef('PaymentStatus'))
  paymentStatus!: string

  /** Contacto de quien compró. */
  @ApiProperty({ type: () => CustomerDto })
  customer!: CustomerDto

  /** Envío. */
  @ApiProperty({ type: () => OrderShippingDto })
  shipping!: OrderShippingDto

  /** Líneas. */
  @ApiProperty({ type: () => [OrderLineDto] })
  lines!: OrderLineDto[]

  /** Suma de los precios de lista. */
  @ApiSchemaProperty(namedRef('TotalArs'))
  itemsGrossArs!: number

  /** Suma de los ahorros por kit y por combo. */
  @ApiSchemaProperty(namedRef('TotalArs'))
  kitSavingsArs!: number

  /** Importe de las líneas sin envío. */
  @ApiSchemaProperty(namedRef('TotalArs'))
  subtotalArs!: number

  /** Costo del envío. */
  @ApiSchemaProperty(namedRef('Pesos'))
  shippingArs!: number

  /** Total con el envío. */
  @ApiSchemaProperty(namedRef('TotalArs'))
  totalArs!: number

  /** Pago. */
  @ApiProperty({ type: () => OrderPaymentDto })
  payment!: OrderPaymentDto

  /** Despacho, o `null`. */
  @ApiSchemaProperty(nullableRef('OrderTracking'))
  tracking!: unknown

  /** Cambios de estado, del más viejo al más nuevo. */
  @ApiProperty({ type: () => [OrderHistoryEntryDto] })
  history!: OrderHistoryEntryDto[]

  /** Vencimiento de la reserva (UTC). */
  @ApiSchemaProperty(DATE_TIME)
  reservedUntil!: string

  /** Creación (UTC). */
  @ApiSchemaProperty(DATE_TIME)
  createdAt!: string
}

/** Pedido recién creado con su token (`CreateOrderResult`). */
@ApiSchema({ name: 'CreateOrderResult' })
export class CreateOrderResultDto {
  /** El pedido. */
  @ApiProperty({ type: () => OrderDto })
  order!: OrderDto

  /** Token del pedido: se entrega solo esta vez. */
  @ApiProperty({ type: 'string', minLength: 1 })
  orderToken!: string
}

/** Pedido en el listado de "Mis pedidos" (`OrderSummary`). */
@ApiSchema({ name: 'OrderSummary' })
export class OrderSummaryDto {
  /** Número de pedido. */
  @ApiSchemaProperty(namedRef('OrderNumber'))
  number!: string

  /** Cuándo se creó (UTC). */
  @ApiSchemaProperty(DATE_TIME)
  createdAt!: string

  /** Estado del pedido. */
  @ApiSchemaProperty(namedRef('OrderStatus'))
  status!: string

  /** Estado del pago. */
  @ApiSchemaProperty(namedRef('PaymentStatus'))
  paymentStatus!: string

  /** Total con el envío. */
  @ApiSchemaProperty(namedRef('TotalArs'))
  totalArs!: number

  /** Unidades del pedido. */
  @ApiProperty({ type: 'integer', minimum: 1 })
  itemCount!: number
}

/** Página de pedidos del cliente (`OrderSummaryPage`). */
@ApiSchema({ name: 'OrderSummaryPage' })
export class OrderSummaryPageDto {
  /** Pedidos de la página. */
  @ApiProperty({ type: () => [OrderSummaryDto] })
  items!: OrderSummaryDto[]

  /** Número de página, desde 1. */
  @ApiProperty({ type: 'integer', minimum: 1 })
  page!: number

  /** Pedidos por página que aplicó el servidor. */
  @ApiProperty({ type: 'integer', minimum: 1, maximum: 100 })
  pageSize!: number

  /** Total de pedidos del cliente. */
  @ApiProperty({ type: 'integer', minimum: 0 })
  total!: number
}

/** Línea del carrito de un producto suelto, de un kit o de un combo, con sus campos comunes. */
function cartItemSchema(
  type: 'product' | 'kit' | 'combo',
  required: readonly string[],
  ids: Readonly<Record<string, OpenApiSchema>>,
  expectedPrice: string,
): OpenApiSchema {
  // Los tipos de `@nestjs/swagger` no tienen `const` (OpenAPI 3.1): va en un objeto aparte.
  const discriminator = { type: 'string', const: type } as const
  return {
    type: 'object',
    required: ['type', ...required],
    properties: {
      type: discriminator,
      ...ids,
      quantity: { type: 'integer', minimum: 1, maximum: 20 },
      expectedUnitPriceArs: schemaRef(expectedPrice),
    },
  }
}

/** Id de un producto (o de un combo) en una línea del carrito. */
const PRODUCT_ID: OpenApiSchema = { type: 'string', minLength: 1, maxLength: 80 }

/**
 * Esquemas de pedidos que no salen de una clase: los escalares y enums con nombre (`OrderNumber`,
 * `OrderStatus`, `PaymentStatus`, `TotalArs`, que identidad publicaba hasta B4, y `LineType`,
 * `PaymentMethod`, `Honeypot`), las líneas del carrito (`CartItemInput` es un `oneOf` con
 * `discriminator`) y los destinos de un envío (`ShippingAddress` es un `oneOf`;
 * `BranchAddressInput` lleva `additionalProperties: false`) y los del dashboard (`AdminOrderPage`
 * y el cuerpo `OrderStatusChange`, con `type: [string, null]`). `buildOpenApiDocument` los suma a
 * `components.schemas`. `Leather`, `Ferrule` y `ShippingMethod` ya los publican catálogo y ajustes.
 */
export const ORDERS_OPENAPI_SCHEMAS: Readonly<Record<string, OpenApiSchema>> = {
  OrderNumber: { type: 'string', pattern: ORDER_NUMBER_PATTERN.source },
  OrderStatus: { type: 'string', enum: [...ORDER_STATUSES] },
  PaymentStatus: { type: 'string', enum: [...PAYMENT_STATUSES] },
  PaymentMethod: { type: 'string', enum: [...PAYMENT_METHODS] },
  LineType: { type: 'string', enum: [...LINE_TYPES] },
  TotalArs: { type: 'integer', minimum: 0, maximum: MAX_TOTAL_ARS },
  Honeypot: { type: ['string', 'null'] },
  CartItemOptions: {
    type: 'object',
    required: ['leather', 'ferrule'],
    properties: { leather: schemaRef('Leather'), ferrule: schemaRef('Ferrule') },
  },
  ProductCartItemInput: cartItemSchema(
    'product',
    ['productId', 'quantity', 'options'],
    { productId: PRODUCT_ID, options: nullableRef('CartItemOptions') },
    'Pesos',
  ),
  KitCartItemInput: cartItemSchema(
    'kit',
    ['mateId', 'bombillaId', 'yerbaId', 'leather', 'quantity'],
    {
      mateId: PRODUCT_ID,
      bombillaId: PRODUCT_ID,
      yerbaId: PRODUCT_ID,
      leather: schemaRef('Leather'),
    },
    'TotalArs',
  ),
  ComboCartItemInput: cartItemSchema(
    'combo',
    ['comboId', 'quantity', 'options'],
    { comboId: PRODUCT_ID, options: nullableRef('CartItemOptions') },
    'Pesos',
  ),
  CartItemInput: {
    oneOf: [
      schemaRef('ProductCartItemInput'),
      schemaRef('KitCartItemInput'),
      schemaRef('ComboCartItemInput'),
    ],
    discriminator: {
      propertyName: 'type',
      mapping: {
        product: '#/components/schemas/ProductCartItemInput',
        kit: '#/components/schemas/KitCartItemInput',
        combo: '#/components/schemas/ComboCartItemInput',
      },
    },
  },
  BranchAddressInput: {
    type: 'object',
    additionalProperties: false,
    required: ['postalCode', 'city', 'province'],
    properties: {
      postalCode: schemaRef('PostalCode'),
      city: { type: 'string', minLength: 2, maxLength: 60 },
      province: schemaRef('Province'),
    },
  },
  ShippingAddress: { oneOf: [schemaRef('AddressInput'), schemaRef('BranchAddressInput')] },
  AdminOrderPage: {
    type: 'object',
    required: ['items', 'page', 'pageSize', 'total'],
    properties: {
      items: { type: 'array', items: schemaRef('Order') },
      page: { type: 'integer', minimum: 1 },
      pageSize: { type: 'integer', minimum: 1, maximum: 100 },
      total: { type: 'integer', minimum: 0 },
    },
  },
  OrderStatusChange: {
    type: 'object',
    required: ['status', 'carrier', 'trackingNumber', 'note'],
    properties: {
      status: { type: 'string', enum: [...ADMIN_ORDER_TARGETS] },
      carrier: { type: ['string', 'null'], minLength: 2, maxLength: 40 },
      trackingNumber: { type: ['string', 'null'], minLength: 4, maxLength: 40 },
      note: { type: ['string', 'null'], maxLength: 500 },
    },
  },
}
