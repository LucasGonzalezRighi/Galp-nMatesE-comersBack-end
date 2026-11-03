import { OrderNotFoundError } from '../../domain/orders-errors'
import type { ExpireOrdersCommand } from '../commands/expire-orders.command'
import type { OrderRepository } from '../ports/order.repository.port'
import type { OrderView } from '../read-models'
import { toOrderView } from '../views'

/** Un pedido de "Mis pedidos" (`GET /me/orders/{number}`): solo si es del cliente de la sesión. */
export class GetMyOrderQuery {
  /**
   * @param orders - Pedidos.
   * @param expire - Vencimiento al leer.
   */
  constructor(
    private readonly orders: OrderRepository,
    private readonly expire: ExpireOrdersCommand,
  ) {}

  /**
   * @param customerId - Cliente de la sesión.
   * @param number - Número del pedido.
   * @returns El pedido (vencido si correspondía).
   * @throws {OrderNotFoundError} 404 si no existe o es de otra persona.
   */
  async execute(customerId: string, number: string): Promise<OrderView> {
    const order = await this.orders.findByNumber(number)
    if (order?.customerId !== customerId) throw new OrderNotFoundError()
    return toOrderView(await this.expire.expireIfDue(order))
  }
}
