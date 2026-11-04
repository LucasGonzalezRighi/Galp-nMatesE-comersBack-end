import type { Clock } from '../../../../shared/domain/clock'
import { type AdminOrderTarget, checkOrderTransition } from '../../domain/admin-order-transitions'
import { adminStatusEvents } from '../../domain/order-events'
import {
  type AdminStatusChange,
  assertAdminStatusChange,
  type Order,
} from '../../domain/order.entity'
import {
  AdminOrderNotFoundError,
  InvalidStatusTransitionError,
  PaymentInProgressError,
} from '../../domain/orders-errors'
import type { ExpireOrdersCommand } from './expire-orders.command'
import type { AdminOrderRepository } from '../ports/admin-order.repository.port'
import type { OrderRepository } from '../ports/order.repository.port'
import type { OrderView } from '../read-models'
import { toOrderView } from '../views'

/** Cambio de estado como lo manda el dashboard (`OrderStatusChange`, ya validado y recortado). */
export interface OrderStatusChangeInput {
  /** Estado nuevo. */
  status: AdminOrderTarget
  /** Empresa de transporte: solo con `shipped`; con los demás, `null`. */
  carrier: string | null
  /** Número de seguimiento: solo con `shipped`; con los demás, `null`. */
  trackingNumber: string | null
  /** Nota del historial, o `null`. */
  note: string | null
}

/**
 * Veces que se reintenta un cambio cuando el `UPDATE` condicional no encuentra el pedido como se
 * leyó (otro lo cambió en el medio): en cada vuelta se relee y se revisa la transición de nuevo.
 */
const MAX_ATTEMPTS = 3

/**
 * Pasa el cambio del dashboard al del dominio.
 *
 * @throws {RangeError} En español, si el destino no es uno de los del dashboard.
 * @throws {TypeError} En español, si el seguimiento no corresponde al destino.
 */
function toAdminStatusChange(input: OrderStatusChangeInput): AdminStatusChange {
  if (input.status !== 'shipped' && (input.carrier !== null || input.trackingNumber !== null)) {
    throw new TypeError('La empresa y el seguimiento solo se cargan al despachar el pedido')
  }
  const change: AdminStatusChange = {
    status: input.status,
    tracking:
      input.status === 'shipped'
        ? { carrier: input.carrier ?? '', number: input.trackingNumber ?? '' }
        : null,
    note: input.note,
  }
  assertAdminStatusChange(change)
  return change
}

/**
 * Lanza el 409 que corresponde si el pedido no puede pasar a `target`.
 *
 * @throws {PaymentInProgressError} Cancelar con un pago `pending` o `action_required`.
 * @throws {InvalidStatusTransitionError} Cualquier otro cambio que no está permitido.
 */
function assertTransition(order: Order, target: AdminOrderTarget): void {
  const check = checkOrderTransition(order.status, order.paymentStatus, target)
  if (check === 'payment_in_progress') throw new PaymentInProgressError()
  if (check === 'invalid_status_transition') {
    throw new InvalidStatusTransitionError(order.status, target)
  }
}

/**
 * Cambio de estado desde el dashboard (`POST /admin/orders/{number}/status`): vence antes el
 * pedido si correspondía, revisa la transición (las mismas de `adminOrderTargets` del front) y la
 * aplica con un `UPDATE` condicional, con los eventos de cada destino (`order.shipped`,
 * `order.delivered`, `order.cancelled` y el aviso a la tienda) en la misma transacción. Un 4xx no
 * deja eventos.
 */
export class ChangeOrderStatusCommand {
  /**
   * @param orders - Pedidos (lectura por número).
   * @param adminOrders - Cambio de estado del dashboard.
   * @param expire - Vencimiento antes de revisar.
   * @param clock - Reloj.
   */
  constructor(
    private readonly orders: Pick<OrderRepository, 'findByNumber'>,
    private readonly adminOrders: Pick<AdminOrderRepository, 'changeStatus'>,
    private readonly expire: Pick<ExpireOrdersCommand, 'expireIfDue'>,
    private readonly clock: Clock,
  ) {}

  /**
   * @param number - Número del pedido.
   * @param input - Cambio pedido.
   * @returns El pedido con el estado nuevo.
   * @throws {RangeError} En español, si el destino no existe.
   * @throws {TypeError} En español, si el seguimiento o la nota no corresponden.
   * @throws {AdminOrderNotFoundError} 404 si el pedido no existe.
   * @throws {PaymentInProgressError} 409 si se pide cancelar con un pago en curso.
   * @throws {InvalidStatusTransitionError} 409 si el pedido no puede pasar a ese estado.
   */
  async execute(number: string, input: OrderStatusChangeInput): Promise<OrderView> {
    const change = toAdminStatusChange(input)
    let order = await this.load(number)
    for (let attempt = 1; ; attempt += 1) {
      assertTransition(order, change.status)
      const current = order
      const changed = await this.adminOrders.changeStatus(
        current,
        change,
        this.clock.now(),
        (cancelledAttemptId) => adminStatusEvents(current, change, cancelledAttemptId),
      )
      if (changed !== null) return toOrderView(changed)
      order = await this.load(number)
      if (attempt === MAX_ATTEMPTS) {
        assertTransition(order, change.status)
        throw new InvalidStatusTransitionError(order.status, change.status)
      }
    }
  }

  /** Lee el pedido y lo vence si correspondía; 404 si no existe. */
  private async load(number: string): Promise<Order> {
    const order = await this.orders.findByNumber(number)
    if (order === null) throw new AdminOrderNotFoundError()
    return this.expire.expireIfDue(order)
  }
}
