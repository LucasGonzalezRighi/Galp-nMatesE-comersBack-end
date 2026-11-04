import type { Clock } from '../../../../shared/domain/clock'
import { orderExpiredEvent, orderStorefrontEvent } from '../../domain/order-events'
import { isExpirable, type Order } from '../../domain/order.entity'
import type { OrderRepository } from '../ports/order.repository.port'

/** Pedidos que vence cada barrido o cada lectura que vence "de paso". */
export const EXPIRE_BATCH_SIZE = 50

/** Pedido de una tanda que no se pudo vencer. */
export interface ExpireFailure {
  /** Id del pedido. */
  orderId: string
  /** Número del pedido. */
  number: string
  /** Lo que lanzó el repositorio. */
  error: unknown
}

/** Resultado de {@link ExpireOrdersCommand.expireDue}. */
export interface ExpireDueResult {
  /** Cuántos pedidos venció. */
  expired: number
  /** Los que no se pudieron vencer (siguen atrasados: el próximo barrido los reintenta). */
  failed: ExpireFailure[]
}

/** Eventos del vencimiento, en la misma transacción: `order.expired` y el aviso a la tienda. */
function expiredEvents(order: Order) {
  return [orderExpiredEvent(order), orderStorefrontEvent('order.expired')]
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
   * Vence una tanda de pedidos atrasados (barrido y antes de cotizar, crear o listar). Cada pedido
   * se vence por separado: si uno falla, sigue con los demás y lo devuelve en `failed` en vez de
   * lanzar, así una limpieza que falla por un pedido ajeno no corta la cotización, la creación ni
   * el listado. Quien llama decide qué hacer con los fallos (el barrido los avisa; acá no hay
   * logger).
   *
   * @param limit - Máximo de pedidos (por defecto {@link EXPIRE_BATCH_SIZE}).
   * @returns Cuántos venció y cuáles fallaron.
   * @throws {RangeError} En español, si `limit` no es un entero positivo.
   * @throws Lo que lance `findDue`: sin la lista de atrasados no hay nada que aislar.
   */
  async expireDue(limit: number = EXPIRE_BATCH_SIZE): Promise<ExpireDueResult> {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new RangeError(
        `El máximo de pedidos a vencer tiene que ser un entero positivo (llegó ${String(limit)})`,
      )
    }
    const now = this.clock.now()
    const due = await this.orders.findDue(now, limit)
    const result: ExpireDueResult = { expired: 0, failed: [] }
    for (const order of due) {
      try {
        if ((await this.orders.expire(order.id, now, expiredEvents)) !== null) result.expired += 1
      } catch (error: unknown) {
        result.failed.push({ orderId: order.id, number: order.number, error })
      }
    }
    return result
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
