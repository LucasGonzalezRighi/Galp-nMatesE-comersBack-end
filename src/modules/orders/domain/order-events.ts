import type { NewDomainEvent } from '../../../shared/domain/domain-event'
import { storefrontStaleEvent } from '../../../shared/domain/storefront-tags'
import type { AdminStatusChange, Order, OrderTracking } from './order.entity'

/** Tipo de agregado de los eventos de pedidos. */
export const ORDER_AGGREGATE = 'order'

/** Evento de pedido creado (con el stock reservado). */
export const ORDER_CREATED_EVENT = 'order.created'

/** Evento de pedido vencido (B5 lo usa para cancelar la preferencia de Mercado Pago). */
export const ORDER_EXPIRED_EVENT = 'order.expired'

/** Evento de pedido pagado (B7 manda el mail de la compra con él). */
export const ORDER_PAID_EVENT = 'order.paid'

/** Cambios de un pedido que mueven el stock que muestra la tienda (reservan o liberan). */
export type OrderStockChange = 'order.created' | 'order.paid' | 'order.expired' | 'order.cancelled'

/** Etiquetas de la tienda que regenera un cambio de stock de un pedido. */
const ORDER_STOREFRONT_TAGS = ['products', 'combos'] as const

const ORDER_STOCK_CHANGES: readonly OrderStockChange[] = [
  'order.created',
  'order.paid',
  'order.expired',
  'order.cancelled',
]

/**
 * Aviso a la tienda (`storefront.stale`) de un pedido que cambió el stock: va en la misma
 * transacción que el cambio, al lado del evento propio del pedido.
 *
 * @param reason - Qué cambio fue (`order.created`, `order.paid`, `order.expired` u
 *   `order.cancelled`).
 * @returns El evento con `{ reason, tags: ['products', 'combos'] }`.
 * @throws {RangeError} En español, si `reason` no es uno de los cuatro cambios.
 */
export function orderStorefrontEvent(reason: OrderStockChange): NewDomainEvent {
  if (!ORDER_STOCK_CHANGES.includes(reason)) {
    throw new RangeError(
      `El cambio de stock de un pedido tiene que ser order.created, order.paid, order.expired u order.cancelled (llegó ${reason})`,
    )
  }
  return storefrontStaleEvent(reason, ORDER_STOREFRONT_TAGS)
}

/**
 * Evento `order.created` para el outbox.
 *
 * @param order - Pedido recién guardado (ya con número).
 * @returns El evento con `{ orderId, number, customerId, totalArs, reservedUntil }`.
 */
export function orderCreatedEvent(order: Order): NewDomainEvent {
  return {
    type: ORDER_CREATED_EVENT,
    aggregateType: ORDER_AGGREGATE,
    aggregateId: order.number,
    payload: {
      orderId: order.id,
      number: order.number,
      customerId: order.customerId,
      totalArs: order.totalArs,
      reservedUntil: order.reservedUntil.toISOString(),
    },
  }
}

/**
 * Evento `order.expired` para el outbox.
 *
 * @param order - Pedido que venció.
 * @returns El evento con `{ orderId, number }`.
 */
export function orderExpiredEvent(order: Order): NewDomainEvent {
  return {
    type: ORDER_EXPIRED_EVENT,
    aggregateType: ORDER_AGGREGATE,
    aggregateId: order.number,
    payload: { orderId: order.id, number: order.number },
  }
}

/**
 * Evento `order.paid` para el outbox.
 *
 * @param order - Pedido pagado.
 * @param paidAt - Momento del pago.
 * @returns El evento con `{ orderId, number, paidAt }`.
 */
export function orderPaidEvent(order: Order, paidAt: Date): NewDomainEvent {
  return {
    type: ORDER_PAID_EVENT,
    aggregateType: ORDER_AGGREGATE,
    aggregateId: order.number,
    payload: { orderId: order.id, number: order.number, paidAt: paidAt.toISOString() },
  }
}

/** Evento de pedido despachado por el admin (B7 manda el mail con el seguimiento). */
export const ORDER_SHIPPED_EVENT = 'order.shipped'

/** Evento de pedido entregado (B7 manda el mail de la entrega). */
export const ORDER_DELIVERED_EVENT = 'order.delivered'

/**
 * Evento de pedido cancelado por el admin: `payments` cierra en Mercado Pago el intento que se
 * canceló en la misma transacción y devuelve lo cobrado (Ruling B-75).
 */
export const ORDER_CANCELLED_EVENT = 'order.cancelled'

/**
 * Evento `order.shipped` para el outbox.
 *
 * @param order - Pedido despachado.
 * @param tracking - Empresa y número de seguimiento.
 * @returns El evento con `{ orderId, number, carrier, trackingNumber }`.
 */
export function orderShippedEvent(order: Order, tracking: OrderTracking): NewDomainEvent {
  return {
    type: ORDER_SHIPPED_EVENT,
    aggregateType: ORDER_AGGREGATE,
    aggregateId: order.number,
    payload: {
      orderId: order.id,
      number: order.number,
      carrier: tracking.carrier,
      trackingNumber: tracking.number,
    },
  }
}

/**
 * Evento `order.delivered` para el outbox.
 *
 * @param order - Pedido entregado.
 * @returns El evento con `{ orderId, number }`.
 */
export function orderDeliveredEvent(order: Order): NewDomainEvent {
  return {
    type: ORDER_DELIVERED_EVENT,
    aggregateType: ORDER_AGGREGATE,
    aggregateId: order.number,
    payload: { orderId: order.id, number: order.number },
  }
}

/**
 * Evento `order.cancelled` para el outbox.
 *
 * @param order - Pedido cancelado.
 * @param cancelledAttemptId - Intento de pago activo que se canceló con el pedido, o `null` si no
 *   había ninguno.
 * @returns El evento con `{ orderId, number, cancelledAttemptId }`.
 * @throws {TypeError} En español, si `cancelledAttemptId` es un texto vacío.
 */
export function orderCancelledEvent(
  order: Order,
  cancelledAttemptId: string | null,
): NewDomainEvent {
  if (cancelledAttemptId !== null && cancelledAttemptId.trim() === '') {
    throw new TypeError('El id del intento cancelado no puede estar vacío')
  }
  return {
    type: ORDER_CANCELLED_EVENT,
    aggregateType: ORDER_AGGREGATE,
    aggregateId: order.number,
    payload: { orderId: order.id, number: order.number, cancelledAttemptId },
  }
}

/**
 * Eventos de un cambio de estado del dashboard, en la misma transacción que el cambio:
 * `preparing` ninguno; `shipped` `order.shipped`; `delivered` `order.delivered`; `cancelled`
 * `order.cancelled` y el aviso a la tienda (`storefront.stale` con `products` y `combos`).
 *
 * @param order - Pedido antes del cambio (id y número).
 * @param change - Cambio pedido.
 * @param cancelledAttemptId - Intento cancelado con el pedido (solo `cancelled`), o `null`.
 * @returns Los eventos, en orden.
 * @throws {TypeError} En español, si un despacho no trae el seguimiento.
 */
export function adminStatusEvents(
  order: Order,
  change: AdminStatusChange,
  cancelledAttemptId: string | null,
): NewDomainEvent[] {
  switch (change.status) {
    case 'preparing':
      return []
    case 'shipped':
      if (change.tracking === null) {
        throw new TypeError('Un despacho necesita la empresa y el número de seguimiento')
      }
      return [orderShippedEvent(order, change.tracking)]
    case 'delivered':
      return [orderDeliveredEvent(order)]
    case 'cancelled':
      return [
        orderCancelledEvent(order, cancelledAttemptId),
        orderStorefrontEvent('order.cancelled'),
      ]
  }
}
