import type { SecretsPort } from '../../../shared/application/ports/secrets.port'
import type { Clock } from '../../../shared/domain/clock'
import type { ExpireOrdersCommand } from '../../orders/application/commands/expire-orders.command'
import type {
  OrderForPayment,
  OrderPaymentsPort,
} from '../../orders/application/ports/order-payments.port'
import { EXPIRABLE_PAYMENT_STATUSES, type PaymentStatus } from '../../orders/domain/order-status'
import { OrderNotFoundError } from '../../orders/domain/orders-errors'
import { OrderNotPayableError } from '../domain/payments-errors'

/** Cómo llega la tienda a un pedido en las rutas de pago: número y `X-Order-Token` (sin sesión). */
export interface OrderAccess {
  /** Número `GLP-NNNNN`. */
  number: string
  /** `X-Order-Token`, o `null` si no vino. */
  token: string | null
}

/** Lo que pagos usa de `ExpireOrdersCommand` (vencer un pedido al leerlo). */
export type OrderExpirer = Pick<ExpireOrdersCommand, 'expireOne'>

/**
 * Lee el pedido de las cuatro rutas de pago: valida el token (404 idéntico sin token, con token
 * ajeno o con un número que no existe), lo vence si la reserva ya se cumplió sin pago (como hace
 * `GET /orders/{number}`) y, para pagar, exige `pending_payment` (409 `order_not_payable`).
 */
export class PaymentOrderAccess {
  /**
   * @param orders - Pedidos para pagos.
   * @param secrets - `sha256` del token.
   * @param expire - Vencimiento de un pedido (`ExpireOrdersCommand`).
   * @param clock - Reloj.
   */
  constructor(
    private readonly orders: OrderPaymentsPort,
    private readonly secrets: SecretsPort,
    private readonly expire: OrderExpirer,
    private readonly clock: Clock,
  ) {}

  /**
   * Busca el pedido con su token.
   *
   * @param access - Número y token.
   * @returns El pedido (vencido si correspondía).
   * @throws {OrderNotFoundError} 404 si no existe o el token falta o no corresponde.
   */
  async find(access: OrderAccess): Promise<OrderForPayment> {
    const order = await this.orders.findForPayment(access.number)
    if (
      order === null ||
      access.token === null ||
      access.token === '' ||
      this.secrets.sha256(access.token) !== order.accessTokenHash
    ) {
      throw new OrderNotFoundError()
    }
    if (this.isDue(order) && (await this.expire.expireOne(order.id)) !== null) {
      return { ...order, status: 'expired' }
    }
    return order
  }

  /**
   * Busca el pedido y exige que admita pagos.
   *
   * @param access - Número y token.
   * @returns El pedido `pending_payment`.
   * @throws {OrderNotFoundError} 404 como {@link PaymentOrderAccess.find}.
   * @throws {OrderNotPayableError} 409 si no está `pending_payment`.
   */
  async payable(access: OrderAccess): Promise<OrderForPayment> {
    const order = await this.find(access)
    if (order.status !== 'pending_payment') throw new OrderNotPayableError(order.status)
    return order
  }

  private isDue(order: OrderForPayment): boolean {
    return (
      order.status === 'pending_payment' &&
      (EXPIRABLE_PAYMENT_STATUSES as readonly PaymentStatus[]).includes(order.paymentStatus) &&
      order.reservedUntil.getTime() <= this.clock.now().getTime()
    )
  }
}
