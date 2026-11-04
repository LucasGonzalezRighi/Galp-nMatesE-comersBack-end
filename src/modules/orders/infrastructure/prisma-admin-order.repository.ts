import { Inject, Injectable } from '@nestjs/common'

import { Prisma } from '../../../generated/prisma/client'
import { CACHE_PORT, type CachePort } from '../../../shared/application/ports/cache.port'
import { createDomainEvent } from '../../../shared/domain/domain-event'
import { newId } from '../../../shared/domain/id'
import { OutboxRepository } from '../../../shared/infrastructure/outbox/outbox.repository'
import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service'
import { searchableTextSql } from '../../../shared/infrastructure/prisma/search-text'
import { catalogCacheVersion } from '../../catalog/infrastructure/catalog-cache'
import type {
  AdminOrderFilter,
  AdminOrderRepository,
  AdminStatusEvents,
} from '../application/ports/admin-order.repository.port'
import type { OrderPage } from '../application/ports/order.repository.port'
import { checkOrderTransition } from '../domain/admin-order-transitions'
import { EXPIRABLE_PAYMENT_STATUSES } from '../domain/order-status'
import { type AdminStatusChange, assertAdminStatusChange, type Order } from '../domain/order.entity'
import { ORDER_INCLUDE, toOrder, UUID_PATTERN } from './order.mapper'
import {
  assertDate,
  catalogCacheKeys,
  releaseReservations,
  TRANSACTION_OPTIONS,
} from './prisma-order.repository'

/** Postgres no guarda el carácter NUL en un `text`: una búsqueda con NUL no coincide con nada. */
const NUL = '\u0000'

/** Donde busca la `q` del dashboard: número, nombre, apellido y email del cliente. */
const ORDER_SEARCH_TEXT = searchableTextSql(
  Prisma.sql`o.number || ' ' || o.contact_first_name || ' ' || o.contact_last_name || ' ' || o.contact_email::text`,
)

/** Lo que dejó aplicado la transacción de un cambio. */
interface AppliedChange {
  /** Intento activo que se canceló con el pedido, o `null`. */
  cancelledAttemptId: string | null
  /** Claves de la caché del catálogo a borrar (solo al cancelar). */
  keys: (version: number) => string[]
}

/** Arma el `WHERE` del listado, o `null` si ninguna fila puede cumplirlo. */
function whereClause(filter: AdminOrderFilter): Prisma.Sql | null {
  if (filter.q?.includes(NUL) === true) return null
  const conditions = [Prisma.sql`TRUE`]
  if (filter.statuses.length > 0) {
    conditions.push(Prisma.sql`o.status = ANY(${[...filter.statuses]}::order_status[])`)
  }
  if (filter.paymentStatus !== null) {
    conditions.push(Prisma.sql`o.payment_status = ${filter.paymentStatus}::payment_status`)
  }
  if (filter.q !== null) conditions.push(Prisma.sql`strpos(${ORDER_SEARCH_TEXT}, ${filter.q}) > 0`)
  return Prisma.join(conditions, ' AND ')
}

/** Valida página y tamaño de página. */
function assertPage(page: number, pageSize: number): void {
  if (!Number.isSafeInteger(page) || page < 1) {
    throw new RangeError(`La página tiene que ser un entero positivo (llegó ${String(page)})`)
  }
  if (!Number.isSafeInteger(pageSize) || pageSize < 1) {
    throw new RangeError(
      `El tamaño de página tiene que ser un entero positivo (llegó ${String(pageSize)})`,
    )
  }
}

/**
 * Cancela un pedido que espera el pago (Ruling B-75): bloquea primero el intento activo (el mismo
 * orden que `PrismaPaymentRepository.update`, intento → pedido, así no hay deadlock), `UPDATE`
 * condicional del pedido (`pending_payment` con el pago `none`, `rejected` o `cancelled`) con
 * `cancelled_at`, libera la reserva y pasa el intento activo a `cancelled` e inactivo junto con
 * `orders.payment_status`: la inversa de B-45, excepción acotada del ADR 0001.
 */
async function cancelOrder(
  tx: Prisma.TransactionClient,
  orderId: string,
  at: Date,
): Promise<AppliedChange | null> {
  await tx.$queryRaw`SELECT id FROM payments WHERE order_id = ${orderId}::uuid AND is_active FOR UPDATE`
  const [updated] = await tx.order.updateManyAndReturn({
    where: {
      id: orderId,
      status: 'pending_payment',
      paymentStatus: { in: [...EXPIRABLE_PAYMENT_STATUSES] },
    },
    data: { status: 'cancelled', cancelledAt: at },
    select: { id: true },
  })
  if (updated === undefined) return null
  const released = await releaseReservations(tx, orderId)
  const [attempt] = await tx.payment.updateManyAndReturn({
    where: { orderId, isActive: true },
    data: { status: 'cancelled', isActive: false, challengeUrl: null },
    select: { id: true },
  })
  if (attempt !== undefined) {
    await tx.order.update({ where: { id: orderId }, data: { paymentStatus: 'cancelled' } })
  }
  return { cancelledAttemptId: attempt?.id ?? null, keys: await catalogCacheKeys(tx, released) }
}

/**
 * Mueve un pedido a `preparing`, `shipped` o `delivered` con `UPDATE … WHERE status = <origen>`;
 * al despachar guarda `shipments` (`shippedAt`) y al entregar, `shipments.deliveredAt`.
 */
async function advanceOrder(
  tx: Prisma.TransactionClient,
  order: Order,
  change: AdminStatusChange,
  at: Date,
): Promise<AppliedChange | null> {
  const { count } = await tx.order.updateMany({
    where: { id: order.id, status: order.status },
    data: { status: change.status },
  })
  if (count === 0) return null
  if (change.status === 'shipped' && change.tracking !== null) {
    const shipment = { carrier: change.tracking.carrier, trackingNumber: change.tracking.number }
    await tx.shipment.upsert({
      where: { orderId: order.id },
      create: { orderId: order.id, ...shipment, shippedAt: at },
      update: { ...shipment, shippedAt: at, deliveredAt: null },
    })
  }
  if (change.status === 'delivered') {
    await tx.shipment.updateMany({ where: { orderId: order.id }, data: { deliveredAt: at } })
  }
  return { cancelledAttemptId: null, keys: () => [] }
}

/**
 * Pedidos del dashboard con Prisma (Postgres): el listado filtra en SQL (estados, pago y la
 * búsqueda sin acentos de `searchableTextSql`) y pagina por `created_at desc, number desc`; el
 * cambio de estado es un `UPDATE` condicional en una transacción con el historial (`actor:
 * admin`), el despacho, la cancelación (reserva, intento activo y `cancelled_at`) y los eventos
 * del outbox. Después de cancelar borra de la caché del catálogo el producto y su grupo, con la
 * versión leída después del commit.
 */
@Injectable()
export class PrismaAdminOrderRepository implements AdminOrderRepository {
  /**
   * @param prisma - Cliente de Prisma de la app.
   * @param outbox - Outbox de eventos (se escribe en la misma transacción).
   * @param cache - Caché del catálogo (falla abierta).
   */
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxRepository,
    @Inject(CACHE_PORT) private readonly cache: CachePort,
  ) {}

  /**
   * {@inheritDoc AdminOrderRepository.list}
   *
   * @throws {RangeError} En español, si `page` o `pageSize` no son enteros positivos.
   */
  async list(filter: AdminOrderFilter, page: number, pageSize: number): Promise<OrderPage> {
    assertPage(page, pageSize)
    const where = whereClause(filter)
    if (where === null) return { items: [], total: 0 }
    const offset = (page - 1) * pageSize
    const [counted, ids] = await Promise.all([
      this.prisma.$queryRaw<{ total: number }[]>`
        SELECT count(*)::int AS total FROM orders o WHERE ${where}`,
      Number.isSafeInteger(offset)
        ? this.prisma.$queryRaw<{ id: string }[]>`
            SELECT o.id FROM orders o WHERE ${where}
            ORDER BY o.created_at DESC, o.number DESC
            LIMIT ${pageSize}::int OFFSET ${offset}::bigint`
        : Promise.resolve([]),
    ])
    const total = counted[0]?.total ?? 0
    if (ids.length === 0) return { items: [], total }
    const rows = await this.prisma.order.findMany({
      where: { id: { in: ids.map((row) => row.id) } },
      include: ORDER_INCLUDE,
    })
    const byId = new Map(rows.map((row) => [row.id, row]))
    const items = ids.flatMap(({ id }) => {
      const row = byId.get(id)
      return row === undefined ? [] : [toOrder(row)]
    })
    return { items, total }
  }

  /**
   * {@inheritDoc AdminOrderRepository.changeStatus}
   *
   * @throws {TypeError} En español, si la fecha o el cambio no son válidos o el pedido leído no
   *   puede pasar a ese estado.
   */
  async changeStatus(
    order: Order,
    change: AdminStatusChange,
    at: Date,
    events: AdminStatusEvents,
  ): Promise<Order | null> {
    assertDate(at, 'El momento del cambio de estado')
    assertAdminStatusChange(change)
    if (checkOrderTransition(order.status, order.paymentStatus, change.status) !== 'ok') {
      throw new TypeError(
        `El pedido ${order.number} no puede pasar de ${order.status} a ${change.status}`,
      )
    }
    if (!UUID_PATTERN.test(order.id)) return null
    const applied = await this.prisma.$transaction(async (tx) => {
      const outcome =
        change.status === 'cancelled'
          ? await cancelOrder(tx, order.id, at)
          : await advanceOrder(tx, order, change, at)
      if (outcome === null) return null
      await tx.orderStatusHistory.create({
        data: {
          id: newId(),
          orderId: order.id,
          fromStatus: order.status,
          toStatus: change.status,
          actor: 'admin',
          note: change.note,
          createdAt: at,
        },
      })
      for (const event of events(outcome.cancelledAttemptId)) {
        await this.outbox.append(tx, createDomainEvent(event, at))
      }
      return outcome
    }, TRANSACTION_OPTIONS)
    if (applied === null) return null
    const keys = applied.keys(await catalogCacheVersion(this.cache))
    if (keys.length > 0) await this.cache.del(...keys)
    const row = await this.prisma.order.findUnique({
      where: { id: order.id },
      include: ORDER_INCLUDE,
    })
    if (row === null) throw new Error(`El pedido ${order.number} desapareció después de cambiarlo`)
    return toOrder(row)
  }
}
