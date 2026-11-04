// Cambios de estado que pide el dashboard: los mismos destinos y la misma regla que
// `frontend/packages/domain/src/admin-orders.ts` (`ADMIN_ORDER_TARGETS`, `adminOrderTargets`,
// `checkOrderTransition`) y los textos de los 409 del mock (`STATUS_TEXT`).

import {
  AWAITING_PAYMENT_STATUSES,
  EXPIRABLE_PAYMENT_STATUSES,
  ORDER_STATUSES,
  type OrderStatus,
  PAYMENT_STATUSES,
  type PaymentStatus,
} from './order-status'

/** Estados a los que el administrador puede mover un pedido (el resto lo escribe el back). */
export const ADMIN_ORDER_TARGETS = [
  'preparing',
  'shipped',
  'delivered',
  'cancelled',
] as const satisfies readonly OrderStatus[]

/** Estado al que el administrador puede mover un pedido. */
export type AdminOrderTarget = (typeof ADMIN_ORDER_TARGETS)[number]

/** Resultado de revisar un cambio de estado: `ok` o el `type` del 409 que corresponde. */
export type OrderTransitionCheck = 'ok' | 'invalid_status_transition' | 'payment_in_progress'

/** Cómo se nombra cada estado en el `detail` de un 409 (`STATUS_TEXT` del mock). */
export const STATUS_TEXT: Readonly<Record<OrderStatus, string>> = {
  pending_payment: 'esperando el pago',
  paid: 'pagado',
  preparing: 'en preparación',
  shipped: 'despachado',
  delivered: 'entregado',
  cancelled: 'cancelado',
  expired: 'vencido',
  refunded: 'devuelto',
}

/** Destinos de cada estado que no espera el pago. */
const TARGETS_BY_STATUS: Readonly<Record<OrderStatus, readonly AdminOrderTarget[]>> = {
  pending_payment: [],
  paid: ['preparing', 'shipped'],
  preparing: ['shipped'],
  shipped: ['delivered'],
  delivered: [],
  cancelled: [],
  expired: [],
  refunded: [],
}

function isOneOf<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (list as readonly string[]).includes(value)
}

/**
 * Indica si un valor es uno de los destinos del dashboard.
 *
 * @param value - Lo que se quiere comprobar.
 * @returns `true` si es un {@link AdminOrderTarget}.
 */
export function isAdminOrderTarget(value: unknown): value is AdminOrderTarget {
  return isOneOf(ADMIN_ORDER_TARGETS, value)
}

/** @throws {RangeError} Si el estado del pedido o el del pago no existen. */
function assertStatuses(status: OrderStatus, paymentStatus: PaymentStatus): void {
  if (!isOneOf(ORDER_STATUSES, status)) {
    throw new RangeError(`Estado de pedido desconocido: "${String(status)}".`)
  }
  if (!isOneOf(PAYMENT_STATUSES, paymentStatus)) {
    throw new RangeError(`Estado de pago desconocido: "${String(paymentStatus)}".`)
  }
}

/**
 * Destinos que el dashboard ofrece para un pedido.
 *
 * - `paid` → `preparing` o `shipped`; `preparing` → `shipped`; `shipped` → `delivered`.
 * - `pending_payment` → `cancelled`, solo con el pago `none`, `rejected` o `cancelled` (con un
 *   pago en curso no se ofrece nada).
 * - `delivered`, `cancelled`, `expired` y `refunded` no tienen destinos.
 *
 * @param status - Estado actual del pedido.
 * @param paymentStatus - Estado actual del pago.
 * @returns Una lista nueva con los destinos, en el orden de {@link ADMIN_ORDER_TARGETS}.
 * @throws {RangeError} En español, si el estado del pedido o el del pago no existen.
 */
export function adminOrderTargets(
  status: OrderStatus,
  paymentStatus: PaymentStatus,
): AdminOrderTarget[] {
  assertStatuses(status, paymentStatus)
  if (status === 'pending_payment') {
    return isOneOf(EXPIRABLE_PAYMENT_STATUSES, paymentStatus) ? ['cancelled'] : []
  }
  return [...TARGETS_BY_STATUS[status]]
}

/**
 * Revisa si un pedido puede pasar a `target`, con la misma regla que el dashboard.
 *
 * @param status - Estado actual del pedido.
 * @param paymentStatus - Estado actual del pago.
 * @param target - Estado al que se lo quiere mover.
 * @returns `ok` si es uno de {@link adminOrderTargets}; `payment_in_progress` si se pide cancelar
 *   un pedido que espera el pago con un pago `pending` o `action_required`; si no,
 *   `invalid_status_transition` (también pasar al mismo estado: despachar dos veces).
 * @throws {RangeError} En español, si el estado del pedido, el del pago o el destino no existen.
 */
export function checkOrderTransition(
  status: OrderStatus,
  paymentStatus: PaymentStatus,
  target: AdminOrderTarget,
): OrderTransitionCheck {
  if (!isAdminOrderTarget(target)) {
    throw new RangeError(`Destino de pedido desconocido: "${String(target)}".`)
  }
  if (adminOrderTargets(status, paymentStatus).includes(target)) return 'ok'
  if (
    status === 'pending_payment' &&
    target === 'cancelled' &&
    isOneOf(AWAITING_PAYMENT_STATUSES, paymentStatus)
  ) {
    return 'payment_in_progress'
  }
  return 'invalid_status_transition'
}
