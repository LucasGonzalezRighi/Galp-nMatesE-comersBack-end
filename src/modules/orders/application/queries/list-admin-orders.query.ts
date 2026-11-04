import { normalizeSearchText } from '../../../catalog/domain/search-text'
import {
  ORDER_STATUSES,
  type OrderStatus,
  PAYMENT_STATUSES,
  type PaymentStatus,
} from '../../domain/order-status'
import type { ExpireOrdersCommand } from '../commands/expire-orders.command'
import type { AdminOrderRepository } from '../ports/admin-order.repository.port'
import type { AdminOrderPageView } from '../read-models'
import { toOrderView } from '../views'

/** Pedidos por página en el dashboard (fijo, como el mock: `ADMIN_ORDERS_PAGE_SIZE`). */
export const ADMIN_ORDERS_PAGE_SIZE = 20

/** Largo máximo del texto a buscar (el del contrato). */
const MAX_QUERY_LENGTH = 100

/** Lo que pide el dashboard al listar. */
export interface AdminOrderListInput {
  /** Página, desde 1. */
  page: number
  /** Estados aceptados; vacío, todos. */
  statuses: readonly OrderStatus[]
  /** Estado del pago, o `null`. */
  paymentStatus: PaymentStatus | null
  /** Texto a buscar tal como llegó (hasta 100 caracteres), o `null`. */
  q: string | null
}

/**
 * Pedidos del dashboard (`GET /admin/orders`): vence antes los atrasados, filtra por estados,
 * estado del pago y texto (sin acentos ni mayúsculas, en el número, el nombre, el apellido y el
 * email) y pagina de a 20, del más nuevo al más viejo. Los ítems son el `Order` completo.
 */
export class ListAdminOrdersQuery {
  /**
   * @param orders - Pedidos del dashboard.
   * @param expire - Vencimiento de los atrasados antes de listar.
   */
  constructor(
    private readonly orders: Pick<AdminOrderRepository, 'list'>,
    private readonly expire: Pick<ExpireOrdersCommand, 'expireDue'>,
  ) {}

  /**
   * @param input - Página y filtros.
   * @returns La página con `pageSize` 20 (fuera de rango, `items` vacío con el total real).
   * @throws {RangeError} En español, si la página no es un entero desde 1, un estado no existe o
   *   el texto pasa de 100 caracteres.
   */
  async execute(input: AdminOrderListInput): Promise<AdminOrderPageView> {
    if (!Number.isSafeInteger(input.page) || input.page < 1) {
      throw new RangeError(
        `La página tiene que ser un entero desde 1; se recibió ${String(input.page)}.`,
      )
    }
    for (const status of input.statuses) {
      if (!(ORDER_STATUSES as readonly string[]).includes(status)) {
        throw new RangeError(`Estado de pedido desconocido: "${status}".`)
      }
    }
    if (
      input.paymentStatus !== null &&
      !(PAYMENT_STATUSES as readonly string[]).includes(input.paymentStatus)
    ) {
      throw new RangeError(`Estado de pago desconocido: "${input.paymentStatus}".`)
    }
    if (input.q !== null && input.q.length > MAX_QUERY_LENGTH) {
      throw new RangeError('El texto a buscar no puede pasar de 100 caracteres.')
    }
    const q = input.q === null ? '' : normalizeSearchText(input.q)
    // Si algún pedido no se pudo vencer, el listado sigue igual: el barrido lo reintenta.
    await this.expire.expireDue()
    const { items, total } = await this.orders.list(
      {
        statuses: [...new Set(input.statuses)],
        paymentStatus: input.paymentStatus,
        q: q === '' ? null : q,
      },
      input.page,
      ADMIN_ORDERS_PAGE_SIZE,
    )
    return {
      items: items.map(toOrderView),
      page: input.page,
      pageSize: ADMIN_ORDERS_PAGE_SIZE,
      total,
    }
  }
}
