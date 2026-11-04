import type { NewDomainEvent } from '../../../../shared/domain/domain-event'
import type { AdminStatusChange, Order } from '../../domain/order.entity'
import type { OrderStatus, PaymentStatus } from '../../domain/order-status'
import type { OrderPage } from './order.repository.port'

/** Filtros del listado de pedidos del dashboard (se combinan: todos tienen que cumplirse). */
export interface AdminOrderFilter {
  /** Estados aceptados; vacío, todos. */
  statuses: readonly OrderStatus[]
  /** Estado del pago (`orders.payment_status`), o `null` para no filtrar. */
  paymentStatus: PaymentStatus | null
  /**
   * Texto ya normalizado (`normalizeSearchText`: sin acentos, en minúsculas y con los espacios
   * colapsados) que se busca entero en el número y el nombre, el apellido y el email del cliente;
   * `null` para no filtrar.
   */
  q: string | null
}

/**
 * Eventos del outbox de un cambio de estado, armados dentro de la transacción: reciben el id del
 * intento de pago activo que se canceló con el pedido (`null` si no había o no es una
 * cancelación).
 */
export type AdminStatusEvents = (cancelledAttemptId: string | null) => NewDomainEvent[]

/** Persistencia de los pedidos que lee y cambia el dashboard. */
export interface AdminOrderRepository {
  /**
   * Pedidos que cumplen los filtros, del más nuevo al más viejo (`createdAt` desc y, a igual
   * fecha, `number` desc).
   *
   * @param filter - Filtros.
   * @param page - Página, desde 1.
   * @param pageSize - Pedidos por página.
   * @returns La página (vacía si está fuera de rango) y el total que cumple los filtros.
   */
  list(filter: AdminOrderFilter, page: number, pageSize: number): Promise<OrderPage>

  /**
   * Aplica el cambio en una transacción con un `UPDATE` condicional sobre el estado que tenía
   * `order` (`WHERE status = <origen>`; al cancelar, además, con el pago `none`, `rejected` o
   * `cancelled`): la fila del historial (`actor: admin`, con la nota), al despachar el `upsert` de
   * `shipments` (`shippedAt`), al entregar `shipments.deliveredAt` y, al cancelar,
   * `orders.cancelled_at`, la reserva liberada, el intento activo `cancelled` e inactivo con
   * `orders.payment_status` (excepción acotada del ADR 0001, Ruling B-75) y el borrado de la
   * caché del catálogo después del commit. Los eventos van en la misma transacción.
   *
   * @param order - Pedido tal como se leyó (id, número, estado de origen).
   * @param change - Cambio, ya validado contra `checkOrderTransition`.
   * @param at - Momento del cambio.
   * @param events - Eventos del outbox.
   * @returns El pedido cambiado, o `null` si el `UPDATE` no encontró el pedido como se leyó (otro
   *   lo cambió en el medio).
   */
  changeStatus(
    order: Order,
    change: AdminStatusChange,
    at: Date,
    events: AdminStatusEvents,
  ): Promise<Order | null>
}

/** Token de inyección del {@link AdminOrderRepository}. */
export const ADMIN_ORDER_REPOSITORY = Symbol('ADMIN_ORDER_REPOSITORY')
