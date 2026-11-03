import type { Order, OrderContact } from '../../domain/order.entity'
import type { OrderStatus, PaymentMethod, PaymentStatus } from '../../domain/order-status'
import type { OrderEvents } from './order.repository.port'

/** Lo que `payments` necesita de un pedido para cobrarlo, sin el resto del pedido. */
export interface OrderForPayment {
  /** Id del pedido. */
  id: string
  /** Número `GLP-NNNNN` (va a Mercado Pago como `external_reference`). */
  number: string
  /** Estado del pedido. */
  status: OrderStatus
  /** Estado del pago (`orders.payment_status`, sincronizado con el último intento). */
  paymentStatus: PaymentStatus
  /** Forma de pago elegida en el checkout. */
  paymentMethod: PaymentMethod
  /** Monto a cobrar, en pesos. */
  totalArs: number
  /** Costo del envío, en pesos (ítem `Envío` de la preferencia si es mayor a 0). */
  shippingCostArs: number
  /** SHA-256 del `orderToken`, para validar `X-Order-Token`. */
  accessTokenHash: string
  /** Hasta cuándo se guarda el stock sin pago (vencimiento de la preferencia). */
  reservedUntil: Date
  /** Creación del pedido. */
  createdAt: Date
  /** Dueño del pedido, o `null`. */
  customerId: string | null
  /** Contacto copiado al pedido (el pagador de la preferencia). */
  contact: OrderContact
  /** Líneas del pedido, en orden (los ítems de la preferencia y del pago). */
  lines: {
    /** Id de la línea. */
    id: string
    /** Nombre copiado al comprar. */
    name: string
    /** Unidades. */
    quantity: number
    /** Total de la línea, en pesos. */
    totalArs: number
  }[]
}

/**
 * Escrituras y lecturas de pedidos que necesita `payments`. Lo define y lo implementa `orders`
 * (`PrismaOrderPaymentsAdapter`) y lo exporta `OrdersModule`, así `payments` no escribe en tablas
 * ajenas ni hay ciclo entre módulos (Ruling B-46).
 */
export interface OrderPaymentsPort {
  /**
   * Busca un pedido por número.
   *
   * @param number - Número `GLP-NNNNN`.
   * @returns El pedido, o `null` si no existe.
   */
  findForPayment(number: string): Promise<OrderForPayment | null>
  /**
   * Busca un pedido por id.
   *
   * @param orderId - Id del pedido.
   * @returns El pedido, o `null` si no existe.
   */
  findForPaymentById(orderId: string): Promise<OrderForPayment | null>
  /**
   * Pasa a pagado solo si sigue `pending_payment` (`UPDATE … WHERE status = 'pending_payment'`):
   * `paid_at`, `payment_status = approved`, reservas `active → committed`, baja `on_hand` y
   * `reserved`, historial `paid` con `actor: provider`, eventos y caché del catálogo, en una
   * transacción. Devuelve `null` si no estaba `pending_payment`.
   *
   * @param orderId - Id del pedido.
   * @param paidAt - Momento del pago (`paid_at` y fecha del historial).
   * @param events - Eventos del outbox, en la misma transacción.
   * @returns El pedido pagado, o `null` si ya no estaba `pending_payment`.
   */
  markPaid(orderId: string, paidAt: Date, events: OrderEvents): Promise<Order | null>
  /**
   * Sincroniza `orders.payment_status` (en la misma transacción que el intento cuando lo llama el
   * repositorio de pagos).
   *
   * @param orderId - Id del pedido.
   * @param status - Estado del pago a guardar.
   */
  setPaymentStatus(orderId: string, status: PaymentStatus): Promise<void>
  /**
   * Pedido devuelto: `status = refunded` si estaba `paid`, `preparing`, `shipped` o `delivered`,
   * con historial `actor: provider`; el stock no vuelve.
   *
   * @param orderId - Id del pedido.
   * @param at - Momento de la devolución (fecha del historial).
   * @param events - Eventos del outbox, en la misma transacción.
   * @returns El pedido devuelto, o `null` si no estaba en un estado que se pueda devolver.
   */
  markRefunded(orderId: string, at: Date, events: OrderEvents): Promise<Order | null>
  /**
   * Pedidos `pending_payment` con `payment_status` `pending` o `action_required` y
   * `reserved_until <= cutoff`, ordenados por `reserved_until` (los concilia el barrido).
   *
   * @param cutoff - Límite de `reserved_until` (incluido).
   * @param limit - Máximo de pedidos a devolver.
   * @returns Los pedidos, del `reserved_until` más viejo al más nuevo.
   */
  listAwaitingPayment(cutoff: Date, limit: number): Promise<OrderForPayment[]>
}

/** Token de inyección del {@link OrderPaymentsPort} (lo exporta `OrdersModule`). */
export const ORDER_PAYMENTS_PORT = Symbol('ORDER_PAYMENTS_PORT')
