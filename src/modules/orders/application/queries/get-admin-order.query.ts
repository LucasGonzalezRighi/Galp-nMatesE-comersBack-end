import { AdminOrderNotFoundError } from '../../domain/orders-errors'
import type { ExpireOrdersCommand } from '../commands/expire-orders.command'
import type { OrderRepository } from '../ports/order.repository.port'
import type { OrderView } from '../read-models'
import { toOrderView } from '../views'

/**
 * Un pedido del dashboard (`GET /admin/orders/{number}`): el mismo `Order` que ve el cliente, con
 * el historial y el pago, vencido antes si ya pasó `reservedUntil`. Sin control de dueño.
 */
export class GetAdminOrderQuery {
  /**
   * @param orders - Pedidos.
   * @param expire - Vencimiento al leer.
   */
  constructor(
    private readonly orders: Pick<OrderRepository, 'findByNumber'>,
    private readonly expire: Pick<ExpireOrdersCommand, 'expireIfDue'>,
  ) {}

  /**
   * @param number - Número del pedido (`GLP-` y cinco dígitos).
   * @returns El pedido.
   * @throws {AdminOrderNotFoundError} 404 "No existe ese pedido." si no existe.
   */
  async execute(number: string): Promise<OrderView> {
    const order = await this.orders.findByNumber(number)
    if (order === null) throw new AdminOrderNotFoundError()
    return toOrderView(await this.expire.expireIfDue(order))
  }
}
