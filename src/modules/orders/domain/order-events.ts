import type { NewDomainEvent } from '../../../shared/domain/domain-event'
import { storefrontStaleEvent } from '../../../shared/domain/storefront-tags'
import type { Order } from './order.entity'

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
