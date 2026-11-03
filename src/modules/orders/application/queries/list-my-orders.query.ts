import type { ExpireOrdersCommand } from '../commands/expire-orders.command'
import type { OrderRepository } from '../ports/order.repository.port'
import type { OrderSummaryPageView } from '../read-models'
import { toOrderSummaryView } from '../views'

/** Pedidos por página en "Mis pedidos" (fijo, como el contrato y el mock). */
export const MY_ORDERS_PAGE_SIZE = 10

/** "Mis pedidos" (`GET /me/orders`): del más nuevo al más viejo, de a 10. */
export class ListMyOrdersQuery {
  /**
   * @param orders - Pedidos.
   * @param expire - Vencimiento de los atrasados antes de listar.
   */
  constructor(
    private readonly orders: OrderRepository,
    private readonly expire: ExpireOrdersCommand,
  ) {}

  /**
   * @param customerId - Cliente de la sesión.
   * @param page - Página, desde 1 (fuera de rango devuelve `items` vacío con el total real).
   * @returns La página de pedidos con `pageSize` 10.
   * @throws {RangeError} En español, si la página no es un entero mayor o igual a 1.
   */
  async execute(customerId: string, page: number): Promise<OrderSummaryPageView> {
    if (!Number.isInteger(page) || page < 1) {
      throw new RangeError(`La página tiene que ser un entero desde 1; se recibió ${String(page)}.`)
    }
    // Si algún pedido no se pudo vencer, el listado sigue igual: el barrido lo reintenta.
    await this.expire.expireDue()
    const { items, total } = await this.orders.listByCustomer(customerId, page, MY_ORDERS_PAGE_SIZE)
    return {
      items: items.map(toOrderSummaryView),
      page,
      pageSize: MY_ORDERS_PAGE_SIZE,
      total,
    }
  }
}
