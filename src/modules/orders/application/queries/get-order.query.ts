import type { SecretsPort } from '../../../../shared/application/ports/secrets.port'
import { OrderNotFoundError } from '../../domain/orders-errors'
import type { ExpireOrdersCommand } from '../commands/expire-orders.command'
import type { OrderRepository } from '../ports/order.repository.port'
import type { OrderView } from '../read-models'
import { toOrderView } from '../views'

/** Credenciales con las que se pide un pedido. */
export interface OrderAccess {
  /** `X-Order-Token` en claro, o `null` si no vino. */
  token: string | null
  /** Cliente de la sesión, o `null` si no hay. */
  customerId: string | null
}

/**
 * Lectura de un pedido (`GET /orders/{number}`) por su token o por la sesión del cliente dueño.
 * Vence el pedido antes de responder si ya pasó `reservedUntil`.
 */
export class GetOrderQuery {
  /**
   * @param orders - Pedidos.
   * @param secrets - SHA-256 del token.
   * @param expire - Vencimiento al leer.
   */
  constructor(
    private readonly orders: OrderRepository,
    private readonly secrets: SecretsPort,
    private readonly expire: ExpireOrdersCommand,
  ) {}

  /**
   * Devuelve el pedido si el token corresponde o, si no, si la sesión es la del dueño.
   *
   * @param number - Número del pedido.
   * @param access - Token y cliente de la sesión.
   * @returns El pedido (vencido si correspondía).
   * @throws {OrderNotFoundError} 404 igual para un número inexistente, un token ajeno o una
   *   sesión ajena.
   */
  async execute(number: string, access: OrderAccess): Promise<OrderView> {
    const order = await this.orders.findByNumber(number)
    if (order === null) throw new OrderNotFoundError()
    const byToken =
      access.token !== null &&
      access.token !== '' &&
      this.secrets.sha256(access.token) === order.accessTokenHash
    const bySession = access.customerId !== null && order.customerId === access.customerId
    if (!byToken && !bySession) throw new OrderNotFoundError()
    return toOrderView(await this.expire.expireIfDue(order))
  }
}
