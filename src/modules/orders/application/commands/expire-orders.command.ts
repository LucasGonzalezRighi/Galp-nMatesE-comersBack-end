import type { Clock } from '../../../../shared/domain/clock'
import { orderExpiredEvent } from '../../domain/order-events'
import { isExpirable, type Order } from '../../domain/order.entity'
import type { OrderRepository } from '../ports/order.repository.port'

/** Pedidos que vence cada barrido o cada lectura que vence "de paso". */
export const EXPIRE_BATCH_SIZE = 50

/** Eventos del vencimiento: `order.expired`, en la misma transacción. */
function expiredEvents(order: Order) {
  return [orderExpiredEvent(order)]
}

/**
 * Vencimiento de pedidos sin pagar: pasa a `expired` los que llegaron a `reservedUntil` sin un
 * pago en curso y libera su stock. Es idempotente (el repositorio actualiza con condición), así
 * que el job diferido, el barrido y la lectura pueden correr sobre el mismo pedido y lo liberan
 * una sola vez.
 */
export class ExpireOrdersCommand {
  /**
   * @param orders - Pedidos.
   * @param clock - Reloj.
   */
  constructor(
    private readonly orders: OrderRepository,
    private readonly clock: Clock,
  ) {}

  /**
   * Vence una tanda de pedidos atrasados (barrido y antes de cotizar, crear o listar).
   *
   * @param limit - Máximo de pedidos (por defecto {@link EXPIRE_BATCH_SIZE}).
   * @returns Cuántos venció.
   * @throws {RangeError} En español, si `limit` no es un entero positivo.
   */
  async expireDue(limit: number = EXPIRE_BATCH_SIZE): Promise<number> {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new RangeError(
        `El máximo de pedidos a vencer tiene que ser un entero positivo (llegó ${String(limit)})`,
      )
    }
    const now = this.clock.now()
    const due = await this.orders.findDue(now, limit)
    let expired = 0
    for (const order of due) {
      if ((await this.orders.expire(order.id, now, expiredEvents)) !== null) expired += 1
    }
    return expired
  }

  /**
   * Vence un pedido por id (job `order.expire`).
   *
   * @param orderId - Id del pedido.
   * @returns El pedido vencido, o `null` si no correspondía (no venció todavía, se pagó o ya lo
   *   venció otro camino).
   */
  expireOne(orderId: string): Promise<Order | null> {
    return this.orders.expire(orderId, this.clock.now(), expiredEvents)
  }

  /**
   * Vence el pedido si corresponde, antes de mostrarlo.
   *
   * @param order - Pedido leído.
   * @returns El pedido vencido si correspondía; si no, el mismo pedido.
   */
  async expireIfDue(order: Order): Promise<Order> {
    const now = this.clock.now()
    if (!isExpirable(order, now)) return order
    const expired = await this.orders.expire(order.id, now, expiredEvents)
    if (expired !== null) return expired
    return (await this.orders.findByNumber(order.number)) ?? order
  }
}
