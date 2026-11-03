import type { NewDomainEvent } from '../../../shared/domain/domain-event'
import type { Order } from './order.entity'

/** Tipo de agregado de los eventos de pedidos. */
export const ORDER_AGGREGATE = 'order'

/** Evento de pedido creado (con el stock reservado). */
export const ORDER_CREATED_EVENT = 'order.created'

/** Evento de pedido vencido (B5 lo usa para cancelar la preferencia de Mercado Pago). */
export const ORDER_EXPIRED_EVENT = 'order.expired'

/** Evento de pedido pagado (B7 manda el mail de la compra con él). */
export const ORDER_PAID_EVENT = 'order.paid'

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
