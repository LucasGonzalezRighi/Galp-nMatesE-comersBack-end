import type { Order } from '../domain/order.entity'
import type { CreateOrderResultView, OrderSummaryView, OrderView } from './read-models'

/**
 * Pasa un pedido a la forma pública `Order`: fechas en ISO 8601 con `Z` y el pago con `null` en
 * todo salvo `method` (los intentos de pago llegan en B5).
 *
 * @param order - Pedido.
 * @returns El pedido como lo devuelve la API.
 */
export function toOrderView(order: Order): OrderView {
  return {
    number: order.number,
    status: order.status,
    paymentStatus: order.paymentStatus,
    customer: { ...order.contact },
    shipping: {
      method: order.shipping.method,
      address: order.shipping.address === null ? null : { ...order.shipping.address },
      costArs: order.shipping.costArs,
      eta: order.shipping.eta,
    },
    lines: order.lines.map((line) => ({
      type: line.type,
      name: line.name,
      detail: line.detail,
      quantity: line.quantity,
      unitPriceArs: line.unitPriceArs,
      kitSavingsArs: line.kitSavingsArs,
      totalArs: line.totalArs,
      productSlug: line.productSlug,
      options: line.options === null ? null : { ...line.options },
      kitItems:
        line.kitItems?.map(({ slug, name, unitPriceArs }) => ({ slug, name, unitPriceArs })) ??
        null,
    })),
    itemsGrossArs: order.itemsGrossArs,
    kitSavingsArs: order.kitSavingsArs,
    subtotalArs: order.subtotalArs,
    shippingArs: order.shipping.costArs,
    totalArs: order.totalArs,
    payment: {
      method: order.paymentMethod,
      installments: null,
      paymentTypeId: null,
      lastFour: null,
      statusDetail: null,
      mpPaymentId: null,
      challenge: null,
    },
    tracking: order.tracking === null ? null : { ...order.tracking },
    history: order.history.map((entry) => ({
      status: entry.status,
      at: entry.at.toISOString(),
      note: entry.note,
    })),
    reservedUntil: order.reservedUntil.toISOString(),
    createdAt: order.createdAt.toISOString(),
  }
}

/**
 * Pasa un pedido a la forma del listado `OrderSummary`.
 *
 * @param order - Pedido.
 * @returns Número, fecha, estados, total y unidades.
 */
export function toOrderSummaryView(order: Order): OrderSummaryView {
  return {
    number: order.number,
    createdAt: order.createdAt.toISOString(),
    status: order.status,
    paymentStatus: order.paymentStatus,
    totalArs: order.totalArs,
    itemCount: order.lines.reduce((sum, line) => sum + line.quantity, 0),
  }
}

/**
 * Arma la respuesta de `POST /orders`.
 *
 * @param order - Pedido creado.
 * @param orderToken - Token en claro (solo viaja en esta respuesta).
 * @returns `{ order, orderToken }`.
 */
export function toCreateOrderResult(order: Order, orderToken: string): CreateOrderResultView {
  return { order: toOrderView(order), orderToken }
}
