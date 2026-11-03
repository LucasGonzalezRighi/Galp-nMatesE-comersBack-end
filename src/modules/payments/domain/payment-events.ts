import type { NewDomainEvent } from '../../../shared/domain/domain-event'
import type { RefundReason } from './payment-attempt'

/** Agregado de los eventos de pagos (`aggregateId` = id del intento). */
export const PAYMENT_AGGREGATE = 'payment'

/** Un pago se aprobó. */
export const PAYMENT_APPROVED_EVENT = 'payment.approved'

/** Un pago se rechazó. */
export const PAYMENT_REJECTED_EVENT = 'payment.rejected'

/** Un pago se devolvió. */
export const PAYMENT_REFUNDED_EVENT = 'payment.refunded'

/** Un pedido quedó pagado (B7 manda el mail con este evento). */
export const ORDER_PAID_EVENT = 'order.paid'

/** Lo que los eventos de pagos copian del pedido. */
export interface PaymentEventOrder {
  /** Id del pedido. */
  id: string
  /** Número `GLP-NNNNN`. */
  number: string
}

/**
 * `payment.approved { orderId, number, paymentId, providerPaymentId, amountArs }`.
 *
 * @param order - Pedido del pago.
 * @param payment - Intento, id en Mercado Pago y monto aprobado.
 * @returns El evento para el outbox.
 */
export function paymentApprovedEvent(
  order: PaymentEventOrder,
  payment: { paymentId: string; providerPaymentId: string; amountArs: number },
): NewDomainEvent {
  return {
    type: PAYMENT_APPROVED_EVENT,
    aggregateType: PAYMENT_AGGREGATE,
    aggregateId: payment.paymentId,
    payload: { orderId: order.id, number: order.number, ...payment },
  }
}

/**
 * `payment.rejected { orderId, number, paymentId, statusDetail }`.
 *
 * @param order - Pedido del pago.
 * @param payment - Intento y detalle del rechazo.
 * @returns El evento para el outbox.
 */
export function paymentRejectedEvent(
  order: PaymentEventOrder,
  payment: { paymentId: string; statusDetail: string | null },
): NewDomainEvent {
  return {
    type: PAYMENT_REJECTED_EVENT,
    aggregateType: PAYMENT_AGGREGATE,
    aggregateId: payment.paymentId,
    payload: { orderId: order.id, number: order.number, ...payment },
  }
}

/**
 * `payment.refunded { orderId, number, paymentId, amountArs, reason }`.
 *
 * @param order - Pedido del pago.
 * @param payment - Intento, monto devuelto y motivo.
 * @returns El evento para el outbox.
 */
export function paymentRefundedEvent(
  order: PaymentEventOrder,
  payment: { paymentId: string; amountArs: number; reason: RefundReason },
): NewDomainEvent {
  return {
    type: PAYMENT_REFUNDED_EVENT,
    aggregateType: PAYMENT_AGGREGATE,
    aggregateId: payment.paymentId,
    payload: { orderId: order.id, number: order.number, ...payment },
  }
}

/**
 * `order.paid { orderId, number, paidAt }` (agregado `order`, `aggregateId` = número), el mismo
 * formato que los eventos de `orders`.
 *
 * @param order - Pedido pagado.
 * @param paidAt - Momento del pago.
 * @returns El evento para el outbox.
 */
export function orderPaidEvent(order: PaymentEventOrder, paidAt: Date): NewDomainEvent {
  return {
    type: ORDER_PAID_EVENT,
    aggregateType: 'order',
    aggregateId: order.number,
    payload: { orderId: order.id, number: order.number, paidAt: paidAt.toISOString() },
  }
}
