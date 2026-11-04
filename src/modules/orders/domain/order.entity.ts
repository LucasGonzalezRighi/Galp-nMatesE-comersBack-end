import type { ShippingMethod } from '../../settings/domain/store-settings.entity'
import {
  type AdminOrderTarget,
  checkOrderTransition,
  isAdminOrderTarget,
} from './admin-order-transitions'
import { ORDER_NUMBER_PATTERN } from './order-number'
import {
  AWAITING_PAYMENT_STATUSES,
  EXPIRABLE_PAYMENT_STATUSES,
  type OrderStatus,
  type PaymentMethod,
  type PaymentStatus,
  REFUNDABLE_ORDER_STATUSES,
} from './order-status'
import type { OrderLineDraft, ReservationLine } from './pricing'
import type { ShippingAddress } from './shipping'

export type { ShippingAddress } from './shipping'

/** Minutos que se reserva el stock de un pedido sin pagar (constante del contrato). */
export const ORDER_RESERVATION_MINUTES = 30

/** Datos de contacto copiados al pedido, tal como se escribieron en el checkout. */
export interface OrderContact {
  /** Email, en minúsculas. */
  email: string
  /** Nombre. */
  firstName: string
  /** Apellido. */
  lastName: string
  /** Teléfono, o `null`. */
  phone: string | null
}

/** Envío copiado al pedido, con el costo y el plazo vigentes al comprar. */
export interface OrderShippingDraft {
  /** Método. */
  method: ShippingMethod
  /** Destino, o `null` en el retiro en persona. */
  address: ShippingAddress | null
  /** Costo en pesos. */
  costArs: number
  /** Plazo estimado. */
  eta: string
}

/** Pedido listo para guardar: el número lo asigna el repositorio con la secuencia. */
export interface OrderDraft {
  /** Id (UUID v7). */
  id: string
  /** Siempre `null`: lo asigna el repositorio. */
  number: null
  /** Cliente dueño, o `null` si solo se lee por token. */
  customerId: string | null
  /** Contacto. */
  contact: OrderContact
  /** Envío. */
  shipping: OrderShippingDraft
  /** Líneas compradas. */
  lines: OrderLineDraft[]
  /** Unidades a reservar por producto. */
  reservation: ReservationLine[]
  /** Suma de los precios de lista. */
  itemsGrossArs: number
  /** Suma de los ahorros por kit. */
  kitSavingsArs: number
  /** `itemsGrossArs − kitSavingsArs`. */
  subtotalArs: number
  /** `subtotalArs + shipping.costArs`. */
  totalArs: number
  /** Descuento del kit vigente al comprar. */
  kitDiscountPercent: number
  /** Forma de pago elegida. */
  paymentMethod: PaymentMethod
  /** SHA-256 del `orderToken` (el token en claro no se guarda). */
  accessTokenHash: string
  /** Momento de la creación. */
  createdAt: Date
  /** `createdAt + 30 min`; no cambia nunca. */
  reservedUntil: Date
}

/** Cambio de estado del pedido. */
export interface OrderHistoryEntry {
  /** Estado nuevo. */
  status: OrderStatus
  /** Cuándo. */
  at: Date
  /** Nota, o `null`. */
  note: string | null
}

/** Datos del despacho. */
export interface OrderTracking {
  /** Empresa de transporte. */
  carrier: string
  /** Número de seguimiento. */
  number: string
}

/**
 * Pago del pedido según su último intento (tabla `payments`); lo que Mercado Pago todavía no
 * informó va en `null`.
 */
export interface OrderPaymentInfo {
  /** Forma de pago del intento. */
  method: PaymentMethod
  /** Estado del intento. */
  status: PaymentStatus
  /** Cuotas, o `null`. */
  installments: number | null
  /** Tipo de medio de pago de Mercado Pago (`credit_card`…), o `null`. */
  paymentTypeId: string | null
  /** Últimos cuatro dígitos de la tarjeta, o `null`. */
  lastFour: string | null
  /** `status_detail` de Mercado Pago, o `null`. */
  statusDetail: string | null
  /** Id del pago en Mercado Pago, o `null`. */
  providerPaymentId: string | null
  /** Dirección de la verificación 3-D Secure, o `null`. */
  challengeUrl: string | null
}

/** Pedido guardado. */
export interface Order extends Omit<OrderDraft, 'number' | 'accessTokenHash' | 'reservation'> {
  /** Número `GLP-` + cinco dígitos. */
  number: string
  /** Estado. */
  status: OrderStatus
  /** Estado del pago. */
  paymentStatus: PaymentStatus
  /** SHA-256 del `orderToken`. */
  accessTokenHash: string
  /** Cambios de estado, del más viejo al más nuevo. */
  history: OrderHistoryEntry[]
  /** Despacho, o `null` mientras no se envió. */
  tracking: OrderTracking | null
  /** Último intento de pago, o `null` si todavía no hubo ninguno. */
  payment: OrderPaymentInfo | null
}

/** Valida que sea una fecha real. */
function assertDate(value: Date, label: string): void {
  if (Number.isNaN(value.getTime())) {
    throw new TypeError(`${label} no es una fecha válida`)
  }
}

/**
 * Vencimiento de la reserva de un pedido.
 *
 * @param createdAt - Momento de la creación.
 * @returns `createdAt` más {@link ORDER_RESERVATION_MINUTES} minutos.
 * @throws {TypeError} En español, si la fecha no es válida.
 */
export function reservedUntilFor(createdAt: Date): Date {
  assertDate(createdAt, 'La fecha de creación del pedido')
  return new Date(createdAt.getTime() + ORDER_RESERVATION_MINUTES * 60_000)
}

/**
 * Pedido recién creado a partir del borrador: `pending_payment`, sin pago, sin despacho y con la
 * primera fila del historial en `createdAt`.
 *
 * @param draft - Borrador.
 * @param number - Número asignado (`GLP-` + cinco dígitos).
 * @returns El pedido (sin la reserva, que vive aparte).
 * @throws {TypeError} En español, si el número no tiene el formato.
 */
export function placeOrder(draft: OrderDraft, number: string): Order {
  if (!ORDER_NUMBER_PATTERN.test(number)) {
    throw new TypeError(
      `El número de pedido tiene que ser GLP- y cinco dígitos (llegó "${number}")`,
    )
  }
  return {
    id: draft.id,
    customerId: draft.customerId,
    contact: draft.contact,
    shipping: draft.shipping,
    lines: draft.lines,
    itemsGrossArs: draft.itemsGrossArs,
    kitSavingsArs: draft.kitSavingsArs,
    subtotalArs: draft.subtotalArs,
    totalArs: draft.totalArs,
    kitDiscountPercent: draft.kitDiscountPercent,
    paymentMethod: draft.paymentMethod,
    accessTokenHash: draft.accessTokenHash,
    createdAt: draft.createdAt,
    reservedUntil: draft.reservedUntil,
    number,
    status: 'pending_payment',
    paymentStatus: 'none',
    history: [{ status: 'pending_payment', at: draft.createdAt, note: null }],
    tracking: null,
    payment: null,
  }
}

/**
 * Indica si un pedido vence: espera el pago, no tiene un pago en curso (`none`, `rejected` o
 * `cancelled`) y ya pasó `reservedUntil`.
 *
 * @param order - Pedido.
 * @param now - Momento actual.
 * @returns `true` si hay que marcarlo `expired` y liberar su stock.
 */
export function isExpirable(order: Order, now: Date): boolean {
  return (
    order.status === 'pending_payment' &&
    (EXPIRABLE_PAYMENT_STATUSES as readonly PaymentStatus[]).includes(order.paymentStatus) &&
    order.reservedUntil.getTime() <= now.getTime()
  )
}

/**
 * Pedido vencido: `expired` y una fila más en el historial con la fecha de `reservedUntil` (no la
 * del momento en que se detectó).
 *
 * @param order - Pedido vencible.
 * @param now - Momento actual.
 * @returns El pedido vencido.
 * @throws {TypeError} En español, si el pedido no se puede vencer a `now`.
 */
export function markExpired(order: Order, now: Date): Order {
  if (!isExpirable(order, now)) {
    throw new TypeError(`El pedido ${order.number} no se puede vencer`)
  }
  return {
    ...order,
    status: 'expired',
    history: [...order.history, { status: 'expired', at: order.reservedUntil, note: null }],
  }
}

/**
 * Pedido pagado: `paid` con el pago `approved` y una fila más en el historial en `paidAt`.
 *
 * @param order - Pedido `pending_payment`.
 * @param paidAt - Momento del pago.
 * @returns El pedido pagado.
 * @throws {TypeError} En español, si la fecha no es válida o el pedido no espera el pago.
 */
export function markPaid(order: Order, paidAt: Date): Order {
  assertDate(paidAt, 'El momento del pago')
  if (order.status !== 'pending_payment') {
    throw new TypeError(
      `El pedido ${order.number} no se puede marcar pagado (está ${order.status})`,
    )
  }
  return {
    ...order,
    status: 'paid',
    paymentStatus: 'approved',
    history: [...order.history, { status: 'paid', at: paidAt, note: null }],
  }
}

/**
 * Indica si un pedido ya cobrado se puede devolver (`paid`, `preparing`, `shipped` o
 * `delivered`).
 *
 * @param order - Pedido.
 * @returns `true` si se puede marcar `refunded`.
 */
export function isRefundable(order: Order): boolean {
  return (REFUNDABLE_ORDER_STATUSES as readonly OrderStatus[]).includes(order.status)
}

/**
 * Pedido devuelto: `refunded` con el pago `refunded` y una fila más en el historial en `at` (el
 * stock no vuelve).
 *
 * @param order - Pedido ya cobrado.
 * @param at - Momento de la devolución.
 * @returns El pedido devuelto.
 * @throws {TypeError} En español, si la fecha no es válida o el pedido no se puede devolver.
 */
export function markRefunded(order: Order, at: Date): Order {
  assertDate(at, 'El momento de la devolución')
  if (!isRefundable(order)) {
    throw new TypeError(`El pedido ${order.number} no se puede devolver (está ${order.status})`)
  }
  return {
    ...order,
    status: 'refunded',
    paymentStatus: 'refunded',
    history: [...order.history, { status: 'refunded', at, note: null }],
  }
}

/** Cambio de estado que pide el dashboard, ya validado y recortado. */
export interface AdminStatusChange {
  /** Estado nuevo. */
  status: AdminOrderTarget
  /** Empresa y número de seguimiento: solo con `shipped`; con los demás, `null`. */
  tracking: OrderTracking | null
  /** Nota del historial, o `null`. */
  note: string | null
}

/** Estados de un intento que todavía está activo (los que cancela la cancelación del admin). */
const OPEN_ATTEMPT_STATUSES: readonly PaymentStatus[] = ['none', ...AWAITING_PAYMENT_STATUSES]

/**
 * Valida un cambio del dashboard: destino conocido, seguimiento solo (y siempre) al despachar.
 *
 * @param change - Cambio pedido.
 * @throws {RangeError} En español, si el destino no es uno de los del dashboard.
 * @throws {TypeError} En español, si el seguimiento o la nota no corresponden.
 */
export function assertAdminStatusChange(change: AdminStatusChange): void {
  if (!isAdminOrderTarget(change.status)) {
    throw new RangeError(`Destino de pedido desconocido: "${String(change.status)}".`)
  }
  if (change.status === 'shipped') {
    if (
      change.tracking === null ||
      change.tracking.carrier.trim() === '' ||
      change.tracking.number.trim() === ''
    ) {
      throw new TypeError('Un despacho necesita la empresa y el número de seguimiento')
    }
  } else if (change.tracking !== null) {
    throw new TypeError('La empresa y el seguimiento solo se cargan al despachar el pedido')
  }
  if (change.note !== null && change.note.trim() === '') {
    throw new TypeError('Una nota vacía va en null')
  }
}

/**
 * Pedido con el estado que pidió el dashboard: una fila más en el historial en `at` con la nota;
 * al despachar, el seguimiento; al cancelar, el intento activo (el último, si sigue en `none`,
 * `pending` o `action_required`) queda `cancelled` y el pago también (sin intentos sigue `none`).
 *
 * @param order - Pedido actual.
 * @param change - Cambio pedido.
 * @param at - Momento del cambio.
 * @returns El pedido cambiado.
 * @throws {TypeError} En español, si la fecha o el cambio no son válidos o el pedido no puede
 *   pasar a ese estado.
 */
export function markAdminStatus(order: Order, change: AdminStatusChange, at: Date): Order {
  assertDate(at, 'El momento del cambio de estado')
  assertAdminStatusChange(change)
  if (checkOrderTransition(order.status, order.paymentStatus, change.status) !== 'ok') {
    throw new TypeError(
      `El pedido ${order.number} no puede pasar de ${order.status} a ${change.status}`,
    )
  }
  const changed: Order = {
    ...order,
    status: change.status,
    history: [...order.history, { status: change.status, at, note: change.note }],
  }
  if (change.status === 'shipped') return { ...changed, tracking: change.tracking }
  if (
    change.status === 'cancelled' &&
    order.payment !== null &&
    OPEN_ATTEMPT_STATUSES.includes(order.payment.status)
  ) {
    return {
      ...changed,
      paymentStatus: 'cancelled',
      payment: { ...order.payment, status: 'cancelled', challengeUrl: null },
    }
  }
  return changed
}
