import type { ShippingMethod } from '../../settings/domain/store-settings.entity'
import { ORDER_NUMBER_PATTERN } from './order-number'
import {
  EXPIRABLE_PAYMENT_STATUSES,
  type OrderStatus,
  type PaymentMethod,
  type PaymentStatus,
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
