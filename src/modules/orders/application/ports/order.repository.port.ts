import type { NewDomainEvent } from '../../../../shared/domain/domain-event'
import type { Result } from '../../../../shared/domain/result'
import type { Order, OrderDraft } from '../../domain/order.entity'

/** Producto que no alcanzó para reservar lo pedido. */
export interface StockShortage {
  /** Id del producto. */
  productId: string
  /** Unidades libres que quedaban (`on_hand − reserved`, 0 si no hay fila de inventario). */
  available: number
}

/** Página de pedidos de un cliente. */
export interface OrderPage {
  /** Pedidos de la página. */
  items: Order[]
  /** Total de pedidos del cliente. */
  total: number
}

/**
 * Eventos que se guardan en el outbox junto con el cambio. Recibe el pedido ya guardado (con su
 * número, que asigna el repositorio) y se llama dentro de la misma transacción.
 */
export type OrderEvents = (order: Order) => NewDomainEvent[]

/** Persistencia de pedidos, reservas de stock e historial. */
export interface OrderRepository {
  /**
   * Crea el pedido en una transacción: asigna el número con `order_number_seq`, reserva el stock
   * de `draft.reservation` (productos ordenados por id, `UPDATE inventory … WHERE on_hand −
   * reserved >= q`, más una fila `stock_reservations` activa por producto que vence en
   * `reservedUntil`), guarda ítems, piezas, la primera fila del historial (`actor: customer`) y
   * los eventos de `events`. Si algún producto no alcanza, no guarda nada.
   *
   * Antes de reservar (y de tomar el número), con el cliente bloqueado, cuenta sus pedidos
   * `pending_payment` (los del email del contacto y, si hay, los de `draft.customerId`): con
   * `MAX_PENDING_ORDERS_PER_CUSTOMER` o más no guarda nada (auditoría NV-14).
   *
   * @param draft - Pedido a guardar.
   * @param events - Eventos del outbox, armados con el pedido ya numerado.
   * @returns `Ok` con el pedido guardado, o `Err` con todos los productos que no alcanzaron.
   * @throws {TooManyPendingOrdersError} 429 si el cliente ya tiene el máximo de pendientes.
   */
  create(draft: OrderDraft, events: OrderEvents): Promise<Result<Order, StockShortage[]>>

  /**
   * @param number - Número `GLP-` + cinco dígitos.
   * @returns El pedido con su historial, o `null` si no existe.
   */
  findByNumber(number: string): Promise<Order | null>

  /**
   * Pedidos de un cliente, del más nuevo al más viejo (`createdAt` desc y, a igual fecha,
   * `number` desc).
   *
   * @param customerId - Cliente dueño.
   * @param page - Página, desde 1.
   * @param pageSize - Pedidos por página.
   * @returns La página (vacía si está fuera de rango) y el total del cliente.
   */
  listByCustomer(customerId: string, page: number, pageSize: number): Promise<OrderPage>

  /**
   * Vence el pedido si sigue vencible a `now` (`pending_payment`, pago `none`, `rejected` o
   * `cancelled` y `reservedUntil <= now`) con un `UPDATE` condicional: si actualizó, libera sus
   * reservas activas (`released`), resta `inventory.reserved`, suma la fila `expired` del
   * historial con fecha `reservedUntil` (`actor: system`) y guarda los eventos. Es idempotente:
   * llamarlo dos veces (o a la vez) libera una sola vez.
   *
   * Los `UPDATE inventory SET reserved = reserved − q` tienen que ir ordenados por `productId`,
   * en el mismo orden que usa {@link create} al reservar: si vencer y crear un pedido
   * multiproducto bloquean las filas de inventario en órdenes distintos, Postgres aborta uno de
   * los dos por deadlock (`40P01`).
   *
   * @param orderId - Id del pedido.
   * @param now - Momento actual.
   * @param events - Eventos del outbox, armados con el pedido vencido.
   * @returns El pedido vencido, o `null` si no estaba vencible (o ya lo venció otro).
   */
  expire(orderId: string, now: Date, events: OrderEvents): Promise<Order | null>

  /**
   * Pedidos vencibles a `now`, los que vencieron antes primero.
   *
   * @param now - Momento actual.
   * @param limit - Máximo de pedidos.
   */
  findDue(now: Date, limit: number): Promise<Order[]>
}

/** Token de inyección del {@link OrderRepository}. */
export const ORDER_REPOSITORY = Symbol('ORDER_REPOSITORY')
