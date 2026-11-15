import { Inject, Injectable } from '@nestjs/common'

import type { Prisma } from '../../../generated/prisma/client'
import { CACHE_PORT, type CachePort } from '../../../shared/application/ports/cache.port'
import { createDomainEvent } from '../../../shared/domain/domain-event'
import { newId } from '../../../shared/domain/id'
import { err, ok, type Result } from '../../../shared/domain/result'
import { OutboxRepository } from '../../../shared/infrastructure/outbox/outbox.repository'
import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service'
import { isProductGroup } from '../../catalog/domain/category.entity'
import {
  catalogCacheVersion,
  productGroupCacheKey,
  productSlugCacheKey,
} from '../../catalog/infrastructure/catalog-cache'
import type {
  OrderEvents,
  OrderPage,
  OrderRepository,
  StockShortage,
} from '../application/ports/order.repository.port'
import { formatOrderNumber } from '../domain/order-number'
import { EXPIRABLE_PAYMENT_STATUSES } from '../domain/order-status'
import {
  isExpirable,
  markExpired,
  MAX_PENDING_ORDERS_PER_CUSTOMER,
  type Order,
  type OrderDraft,
  placeOrder,
} from '../domain/order.entity'
import { TooManyPendingOrdersError } from '../domain/orders-errors'
import type { ReservationLine } from '../domain/pricing'
import {
  ORDER_INCLUDE,
  UUID_PATTERN,
  cartItemOptionsJson,
  shippingAddressJson,
  toOrder,
} from './order.mapper'

/**
 * Opciones de las transacciones de pedidos: hasta 5 s para conseguir conexión (con muchos
 * pedidos a la vez el pool se llena) y 15 s para terminar.
 */
export const TRANSACTION_OPTIONS = { maxWait: 5_000, timeout: 15_000 } as const

/** Prefijo del bloqueo consultivo del cupo de pedidos pendientes de un cliente. */
const PENDING_LOCK_PREFIX = 'orders:pending:'

/** Máximo de pedidos de un barrido (vencimiento y conciliación de pagos). */
const MAX_DUE_LIMIT = 1_000

/** Error interno: algún producto no alcanzó y la transacción se deshace. */
class StockShortageError extends Error {
  constructor(readonly shortages: StockShortage[]) {
    super('No alcanzó el stock para reservar el pedido')
  }
}

/**
 * Ordena por id de producto: todas las transacciones bloquean el inventario en el mismo orden
 * (así dos transacciones sobre los mismos productos no se bloquean entre sí: `40P01`).
 *
 * @param lines - Líneas con `productId`.
 * @returns Una copia ordenada por `productId` ascendente.
 */
export function byProductId<T extends { productId: string }>(lines: readonly T[]): T[] {
  return [...lines].sort((a, b) =>
    a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0,
  )
}

/**
 * Valida una fecha recibida.
 *
 * @param value - Fecha.
 * @param label - Qué es, para el mensaje.
 * @throws {TypeError} En español, si no es una fecha válida.
 */
export function assertDate(value: Date, label: string): void {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new TypeError(`${label} no es una fecha válida`)
  }
}

/** Valida las unidades a reservar: al menos un producto, con enteros positivos. */
function assertReservation(reservation: readonly ReservationLine[]): void {
  if (reservation.length === 0) {
    throw new RangeError('Un pedido tiene que reservar al menos un producto')
  }
  for (const line of reservation) {
    if (!Number.isSafeInteger(line.quantity) || line.quantity < 1) {
      throw new RangeError(
        `Las unidades a reservar tienen que ser un entero positivo (llegó ${String(line.quantity)})`,
      )
    }
  }
}

/** Unidades libres de un producto (`on_hand − reserved`, 0 si no hay fila de inventario). */
async function availableOf(tx: Prisma.TransactionClient, productId: string): Promise<number> {
  const rows = await tx.$queryRaw<{ available: number }[]>`
    SELECT GREATEST(on_hand - reserved, 0)::int AS available
    FROM inventory WHERE product_id = ${productId}::uuid`
  return rows[0]?.available ?? 0
}

/**
 * Reserva el stock de cada producto (ya ordenados por id) con un `UPDATE` condicional. Si alguno
 * no alcanza, sigue con los demás para juntar **todos** los faltantes y lanza
 * {@link StockShortageError} (la transacción se deshace).
 */
async function reserveStock(
  tx: Prisma.TransactionClient,
  reservation: readonly ReservationLine[],
): Promise<void> {
  const shortages: StockShortage[] = []
  for (const line of reservation) {
    const updated = await tx.$executeRaw`
      UPDATE inventory
      SET reserved = reserved + ${line.quantity}, version = version + 1, updated_at = now()
      WHERE product_id = ${line.productId}::uuid AND on_hand - reserved >= ${line.quantity}`
    if (updated === 0) {
      shortages.push({
        productId: line.productId,
        available: await availableOf(tx, line.productId),
      })
    }
  }
  if (shortages.length > 0) throw new StockShortageError(shortages)
}

/** Siguiente valor de `order_number_seq` (falla al pasar de 99.999). */
async function nextOrderSequence(tx: Prisma.TransactionClient): Promise<number> {
  const rows = await tx.$queryRaw<{ n: number }[]>`SELECT nextval('order_number_seq')::int AS n`
  const value = rows[0]?.n
  if (value === undefined) throw new Error('La secuencia de pedidos no devolvió un valor')
  return value
}

/**
 * Claves de la caché del catálogo (slug y grupo) de los productos cuyo stock cambió. Los slugs y
 * los grupos se leen en la transacción; la versión, **después** del commit y justo antes de
 * borrar: `await this.cache.del(...keys(await catalogCacheVersion(this.cache)))` (si se leyera
 * antes, un bump en el medio dejaría la versión nueva con el stock viejo hasta que venza).
 *
 * @param tx - Transacción abierta.
 * @param productIds - Productos tocados.
 * @returns Las claves a borrar en una versión de la caché.
 */
export async function catalogCacheKeys(
  tx: Prisma.TransactionClient,
  productIds: readonly string[],
): Promise<(version: number) => string[]> {
  if (productIds.length === 0) return () => []
  // SQL directo: un `include` dentro de la transacción manda consultas en paralelo por la misma
  // conexión (pg lo marca como obsoleto).
  const products = await tx.$queryRaw<{ slug: string; group: string }[]>`
    SELECT p.slug, c."group"::text AS "group"
    FROM products p JOIN categories c ON c.id = p.category_id
    WHERE p.id = ANY(${[...productIds]}::uuid[])`
  const groups = [...new Set(products.map((product) => product.group).filter(isProductGroup))]
  return (version) => [
    ...products.map((product) => productSlugCacheKey(product.slug, version)),
    ...groups.map((group) => productGroupCacheKey(group, version)),
  ]
}

/** Guarda el pedido numerado: fila, líneas, piezas, primera fila del historial y reservas. */
async function insertOrder(
  tx: Prisma.TransactionClient,
  order: Order,
  reservation: readonly ReservationLine[],
): Promise<void> {
  await tx.order.create({
    data: {
      id: order.id,
      number: order.number,
      customerId: order.customerId,
      status: order.status,
      paymentStatus: order.paymentStatus,
      paymentMethod: order.paymentMethod,
      contactEmail: order.contact.email,
      contactFirstName: order.contact.firstName,
      contactLastName: order.contact.lastName,
      contactPhone: order.contact.phone,
      shippingMethod: order.shipping.method,
      shippingAddress: shippingAddressJson(order.shipping.address),
      shippingCostArs: order.shipping.costArs,
      shippingEta: order.shipping.eta,
      itemsGrossArs: order.itemsGrossArs,
      kitSavingsArs: order.kitSavingsArs,
      subtotalArs: order.subtotalArs,
      totalArs: order.totalArs,
      kitDiscountPercent: order.kitDiscountPercent,
      accessTokenHash: order.accessTokenHash,
      reservedUntil: order.reservedUntil,
      placedAt: order.createdAt,
      createdAt: order.createdAt,
    },
  })
  const items = order.lines.map((line, position) => ({ id: newId(), line, position }))
  await tx.orderItem.createMany({
    data: items.map(({ id, line, position }) => ({
      id,
      orderId: order.id,
      lineType: line.type,
      productId: line.productId,
      productSlug: line.productSlug,
      name: line.name,
      detail: line.detail,
      quantity: line.quantity,
      unitPriceArs: line.unitPriceArs,
      kitSavingsArs: line.kitSavingsArs,
      totalArs: line.totalArs,
      options: cartItemOptionsJson(line.options),
      position,
    })),
  })
  const components = items.flatMap(({ id, line }) =>
    (line.kitItems ?? []).map((piece) => ({
      orderItemId: id,
      role: piece.role,
      position: piece.position,
      productId: piece.productId,
      slug: piece.slug,
      name: piece.name,
      unitPriceArs: piece.unitPriceArs,
    })),
  )
  if (components.length > 0) await tx.orderItemComponent.createMany({ data: components })
  await tx.orderStatusHistory.create({
    data: {
      id: newId(),
      orderId: order.id,
      fromStatus: null,
      toStatus: 'pending_payment',
      actor: 'customer',
      note: null,
      createdAt: order.createdAt,
    },
  })
  await tx.stockReservation.createMany({
    data: reservation.map((line) => ({
      id: newId(),
      orderId: order.id,
      productId: line.productId,
      quantity: line.quantity,
      status: 'active' as const,
      expiresAt: order.reservedUntil,
    })),
  })
}

/** Reservas activas de un pedido, ordenadas por id de producto (el orden de los bloqueos). */
async function activeReservations(
  tx: Prisma.TransactionClient,
  orderId: string,
): Promise<ReservationLine[]> {
  return byProductId(
    await tx.stockReservation.findMany({
      where: { orderId, status: 'active' },
      select: { productId: true, quantity: true },
    }),
  )
}

/**
 * Confirma las reservas activas de un pedido pagado: baja `on_hand` y `reserved` de cada producto
 * (por id de producto, como al reservar) y las marca `committed`.
 *
 * @param tx - Transacción abierta (la misma que pasa el pedido a pagado).
 * @param orderId - Pedido.
 * @returns Los productos cuyo stock bajó.
 */
export async function commitReservations(
  tx: Prisma.TransactionClient,
  orderId: string,
): Promise<string[]> {
  const active = await activeReservations(tx, orderId)
  for (const reservation of active) {
    await tx.$executeRaw`
      UPDATE inventory
      SET on_hand = on_hand - ${reservation.quantity}, reserved = reserved - ${reservation.quantity},
        version = version + 1, updated_at = now()
      WHERE product_id = ${reservation.productId}::uuid`
  }
  await tx.stockReservation.updateMany({
    where: { orderId, status: 'active' },
    data: { status: 'committed' },
  })
  return active.map((reservation) => reservation.productId)
}

/**
 * Valida el máximo de pedidos de un barrido.
 *
 * @param limit - Máximo pedido.
 * @param label - Qué se limita, para el mensaje.
 * @throws {RangeError} En español, si no es un entero de 1 a 1000.
 */
export function assertBatchLimit(limit: number, label: string): void {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_DUE_LIMIT) {
    throw new RangeError(
      `${label} tiene que ser un entero de 1 a ${String(MAX_DUE_LIMIT)} (llegó ${String(limit)})`,
    )
  }
}

/**
 * Cupo de pedidos pendientes (auditoría NV-14): bloquea al cliente (su email y, si hay, su id, en
 * ese orden para que dos altas no se traben entre sí) y cuenta sus pedidos `pending_payment`.
 * Corre antes de reservar y de `nextval`, así un pedido rechazado no gasta stock ni número.
 *
 * @param tx - Transacción abierta.
 * @param draft - Pedido a guardar (contacto, dueño y hora de creación).
 * @throws {TooManyPendingOrdersError} 429 si ya tiene `MAX_PENDING_ORDERS_PER_CUSTOMER`.
 */
async function assertPendingQuota(tx: Prisma.TransactionClient, draft: OrderDraft): Promise<void> {
  const email = draft.contact.email.toLowerCase()
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${PENDING_LOCK_PREFIX + 'email:' + email}))`
  if (draft.customerId !== null) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${PENDING_LOCK_PREFIX + 'customer:' + draft.customerId}))`
  }
  const pending = await tx.order.aggregate({
    where: {
      status: 'pending_payment',
      OR: [
        { contactEmail: email },
        ...(draft.customerId === null ? [] : [{ customerId: draft.customerId }]),
      ],
    },
    _count: { _all: true },
    _min: { reservedUntil: true },
  })
  if (pending._count._all < MAX_PENDING_ORDERS_PER_CUSTOMER) return
  throw new TooManyPendingOrdersError(
    pending._min.reservedUntil ?? draft.createdAt,
    draft.createdAt,
  )
}

/**
 * Libera las reservas activas de un pedido: devuelve las unidades a `inventory` (por id de
 * producto, como al reservar) y las marca `released`. La usan el vencimiento y la cancelación del
 * dashboard (`PrismaAdminOrderRepository`).
 *
 * @param tx - Transacción abierta.
 * @param orderId - Id del pedido.
 * @returns Los productos liberados.
 */
export async function releaseReservations(
  tx: Prisma.TransactionClient,
  orderId: string,
): Promise<string[]> {
  const active = await activeReservations(tx, orderId)
  for (const reservation of active) {
    await tx.$executeRaw`
      UPDATE inventory
      SET reserved = reserved - ${reservation.quantity}, version = version + 1, updated_at = now()
      WHERE product_id = ${reservation.productId}::uuid`
  }
  await tx.stockReservation.updateMany({
    where: { orderId, status: 'active' },
    data: { status: 'released' },
  })
  return active.map((reservation) => reservation.productId)
}

/**
 * Pedidos con Prisma (Postgres): la creación reserva el stock con `UPDATE inventory … WHERE
 * on_hand − reserved >= q` dentro de la misma transacción que el pedido, sus líneas, el historial,
 * las filas de `stock_reservations` y los eventos del outbox; el vencimiento es un `UPDATE`
 * condicional, así que es idempotente aunque corran a la vez el job, el barrido y la lectura.
 * Después de reservar o liberar borra de la caché el producto (`slug`) y su grupo.
 */
@Injectable()
export class PrismaOrderRepository implements OrderRepository {
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

  /** {@inheritDoc OrderRepository.create} */
  async create(draft: OrderDraft, events: OrderEvents): Promise<Result<Order, StockShortage[]>> {
    assertReservation(draft.reservation)
    const reservation = byProductId(draft.reservation)
    try {
      const { order, keys } = await this.prisma.$transaction(async (tx) => {
        await assertPendingQuota(tx, draft)
        await reserveStock(tx, reservation)
        const placed = placeOrder(draft, formatOrderNumber(await nextOrderSequence(tx)))
        await insertOrder(tx, placed, reservation)
        for (const event of events(placed)) {
          await this.outbox.append(tx, createDomainEvent(event, placed.createdAt))
        }
        const touched = reservation.map((line) => line.productId)
        return { order: placed, keys: await catalogCacheKeys(tx, touched) }
      }, TRANSACTION_OPTIONS)
      await this.cache.del(...keys(await catalogCacheVersion(this.cache)))
      return ok(order)
    } catch (error) {
      if (error instanceof StockShortageError) return err(error.shortages)
      throw error
    }
  }

  /** {@inheritDoc OrderRepository.findByNumber} */
  async findByNumber(number: string): Promise<Order | null> {
    const row = await this.prisma.order.findUnique({ where: { number }, include: ORDER_INCLUDE })
    return row === null ? null : toOrder(row)
  }

  /**
   * {@inheritDoc OrderRepository.listByCustomer}
   *
   * @throws {RangeError} En español, si `page` o `pageSize` no son enteros positivos.
   */
  async listByCustomer(customerId: string, page: number, pageSize: number): Promise<OrderPage> {
    if (!Number.isSafeInteger(page) || page < 1) {
      throw new RangeError(`La página tiene que ser un entero positivo (llegó ${String(page)})`)
    }
    if (!Number.isSafeInteger(pageSize) || pageSize < 1) {
      throw new RangeError(
        `El tamaño de página tiene que ser un entero positivo (llegó ${String(pageSize)})`,
      )
    }
    if (!UUID_PATTERN.test(customerId)) return { items: [], total: 0 }
    const [total, rows] = await Promise.all([
      this.prisma.order.count({ where: { customerId } }),
      this.prisma.order.findMany({
        where: { customerId },
        orderBy: [{ createdAt: 'desc' }, { number: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: ORDER_INCLUDE,
      }),
    ])
    return { items: rows.map(toOrder), total }
  }

  /**
   * {@inheritDoc OrderRepository.expire}
   *
   * @throws {TypeError} En español, si `now` no es una fecha válida.
   */
  async expire(orderId: string, now: Date, events: OrderEvents): Promise<Order | null> {
    assertDate(now, 'El momento del vencimiento')
    if (!UUID_PATTERN.test(orderId)) return null
    const row = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: ORDER_INCLUDE,
    })
    if (row === null) return null
    const current = toOrder(row)
    if (!isExpirable(current, now)) return null
    const outcome = await this.prisma.$transaction(async (tx) => {
      const [updated] = await tx.order.updateManyAndReturn({
        where: {
          id: orderId,
          status: 'pending_payment',
          paymentStatus: { in: [...EXPIRABLE_PAYMENT_STATUSES] },
          reservedUntil: { lte: now },
        },
        data: { status: 'expired' },
        select: { paymentStatus: true },
      })
      if (updated === undefined) return null
      await tx.orderStatusHistory.create({
        data: {
          id: newId(),
          orderId,
          fromStatus: 'pending_payment',
          toStatus: 'expired',
          actor: 'system',
          note: null,
          createdAt: current.reservedUntil,
        },
      })
      const released = await releaseReservations(tx, orderId)
      // El pago pudo pasar a rejected/cancelled después de leerlo: vale el que actualizó.
      const order = markExpired({ ...current, paymentStatus: updated.paymentStatus }, now)
      for (const event of events(order)) {
        await this.outbox.append(tx, createDomainEvent(event, now))
      }
      return { order, keys: await catalogCacheKeys(tx, released) }
    }, TRANSACTION_OPTIONS)
    if (outcome === null) return null
    await this.cache.del(...outcome.keys(await catalogCacheVersion(this.cache)))
    return outcome.order
  }

  /**
   * {@inheritDoc OrderRepository.findDue}
   *
   * @throws {TypeError} En español, si `now` no es una fecha válida.
   * @throws {RangeError} En español, si `limit` no es un entero de 1 a 1000.
   */
  async findDue(now: Date, limit: number): Promise<Order[]> {
    assertDate(now, 'El momento del vencimiento')
    assertBatchLimit(limit, 'El máximo de pedidos a vencer')
    const rows = await this.prisma.order.findMany({
      where: {
        status: 'pending_payment',
        paymentStatus: { in: [...EXPIRABLE_PAYMENT_STATUSES] },
        reservedUntil: { lte: now },
      },
      orderBy: [{ reservedUntil: 'asc' }, { id: 'asc' }],
      take: limit,
      include: ORDER_INCLUDE,
    })
    return rows.map(toOrder)
  }
}
