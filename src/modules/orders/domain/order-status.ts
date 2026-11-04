/** Estados de un pedido (`OrderStatus` del contrato), en el orden del ciclo normal. */
export const ORDER_STATUSES = [
  'pending_payment',
  'paid',
  'preparing',
  'shipped',
  'delivered',
  'cancelled',
  'expired',
  'refunded',
] as const

/** Estado de un pedido: `pending_payment` espera el pago con el stock reservado. */
export type OrderStatus = (typeof ORDER_STATUSES)[number]

/** Estados del pago de un pedido (`PaymentStatus` del contrato). */
export const PAYMENT_STATUSES = [
  'none',
  'pending',
  'action_required',
  'approved',
  'rejected',
  'cancelled',
  'refunded',
  'partially_refunded',
  'in_dispute',
  'charged_back',
] as const

/** Estado del pago: `none` es que todavía no hubo ningún intento. */
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number]

/**
 * Estados del pago con los que un pedido `pending_payment` puede vencer: sin intento o con un
 * intento que ya terminó sin cobrar. Un pago `pending` o `action_required` no vence (B5 decide).
 */
export const EXPIRABLE_PAYMENT_STATUSES = [
  'none',
  'rejected',
  'cancelled',
] as const satisfies readonly PaymentStatus[]

/**
 * Estados del pago que esperan una respuesta de Mercado Pago: el pedido no vence y la
 * conciliación los consulta.
 */
export const AWAITING_PAYMENT_STATUSES = [
  'pending',
  'action_required',
] as const satisfies readonly PaymentStatus[]

/** Estados del pedido que ya se cobraron y se pueden devolver. */
export const REFUNDABLE_ORDER_STATUSES = [
  'paid',
  'preparing',
  'shipped',
  'delivered',
] as const satisfies readonly OrderStatus[]

/**
 * Indica si un texto es un estado del pago.
 *
 * @param value - Lo que se quiere comprobar.
 * @returns `true` si es un {@link PaymentStatus}.
 */
export function isPaymentStatus(value: unknown): value is PaymentStatus {
  return typeof value === 'string' && (PAYMENT_STATUSES as readonly string[]).includes(value)
}

/** Formas de pago del checkout (`PaymentMethod` del contrato). */
export const PAYMENT_METHODS = ['mp_redirect', 'card'] as const

/** Forma de pago: `mp_redirect` lleva a Mercado Pago y `card` cobra dentro de la tienda. */
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]

/** Tipos de línea (`LineType` del contrato). */
export const LINE_TYPES = ['product', 'kit', 'combo'] as const

/**
 * Tipo de línea: un producto suelto, un kit de mate, bombilla y yerba con descuento o un combo de
 * productos fijos con precio final.
 */
export type LineType = (typeof LINE_TYPES)[number]

/** Quién hizo un cambio de estado (columna `order_status_history.actor`). */
export const ORDER_ACTORS = ['system', 'admin', 'customer', 'provider'] as const

/** Autor de un cambio de estado del pedido. */
export type OrderActor = (typeof ORDER_ACTORS)[number]

/**
 * Indica si un texto es una forma de pago del contrato.
 *
 * @param value - Lo que se quiere comprobar.
 * @returns `true` si es un {@link PaymentMethod}.
 */
export function isPaymentMethod(value: unknown): value is PaymentMethod {
  return typeof value === 'string' && (PAYMENT_METHODS as readonly string[]).includes(value)
}
