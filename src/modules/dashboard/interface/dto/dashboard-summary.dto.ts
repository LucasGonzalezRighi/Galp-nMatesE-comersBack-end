// DTO de respuesta del resumen, solo para Swagger: reproduce `DashboardSummary` del contrato (con
// sus ítems en línea) y el test de contrato lo compara. Nunca se instancia (el controlador devuelve
// el read model de `application`).

import { ApiSchema } from '@nestjs/swagger'

import { ApiSchemaProperty, schemaRef } from '../../../../shared/infrastructure/http/openapi'
import { PAYMENT_ALERT_KINDS } from '../../domain/payment-alerts'

/** Entero no negativo (sumas y cantidades). */
const COUNT = { type: 'integer', minimum: 0 } as const

/** Cifras del inicio del dashboard (`DashboardSummary`). */
@ApiSchema({ name: 'DashboardSummary' })
export class DashboardSummaryDto {
  /** Total vendido hoy (día de Buenos Aires). */
  @ApiSchemaProperty(COUNT)
  salesTodayArs!: number

  /** Total vendido en los últimos 7 días, hoy incluido. */
  @ApiSchemaProperty(COUNT)
  salesLast7DaysArs!: number

  /** Pedidos pagados o en preparación. */
  @ApiSchemaProperty(COUNT)
  ordersToShip!: number

  /** Publicados con stock disponible menor o igual al umbral de los ajustes. */
  @ApiSchemaProperty({
    type: 'array',
    items: {
      type: 'object',
      required: ['id', 'name', 'stock'],
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        stock: COUNT,
      },
    },
  })
  lowStock!: { id: string; name: string; stock: number }[]

  /** Reseñas pendientes de moderación. */
  @ApiSchemaProperty(COUNT)
  pendingReviews!: number

  /** Mensajes de la bandeja sin leer. */
  @ApiSchemaProperty(COUNT)
  unreadMessages!: number

  /** Pedidos con un problema de pago que hay que mirar. */
  @ApiSchemaProperty({
    type: 'array',
    items: {
      type: 'object',
      required: ['orderNumber', 'kind', 'message'],
      properties: {
        orderNumber: schemaRef('OrderNumber'),
        kind: { type: 'string', enum: [...PAYMENT_ALERT_KINDS] },
        message: { type: 'string' },
      },
    },
  })
  paymentAlerts!: { orderNumber: string; kind: string; message: string }[]
}
