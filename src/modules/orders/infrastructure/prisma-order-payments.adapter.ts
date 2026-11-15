import { Inject, Injectable } from '@nestjs/common'

import type { Prisma } from '../../../generated/prisma/client'
import { CACHE_PORT, type CachePort } from '../../../shared/application/ports/cache.port'
import { createDomainEvent } from '../../../shared/domain/domain-event'
import { newId } from '../../../shared/domain/id'
import { OutboxRepository } from '../../../shared/infrastructure/outbox/outbox.repository'
import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service'
import type { OrderForPayment, OrderPaymentsPort } from '../application/ports/order-payments.port'
import type { OrderEvents } from '../application/ports/order.repository.port'
import {
  AWAITING_PAYMENT_STATUSES,
  isPaymentStatus,
  type PaymentStatus,
  REFUNDABLE_ORDER_STATUSES,
} from '../domain/order-status'
import { isRefundable, markPaid, markRefunded, type Order } from '../domain/order.entity'
import { catalogCacheVersion } from '../../catalog/infrastructure/catalog-cache'
import { ORDER_INCLUDE, toOrder, UUID_PATTERN } from './order.mapper'
import {
  assertBatchLimit,
  assertDate,
  catalogCacheKeys,
  commitReservations,
  TRANSACTION_OPTIONS,
} from './prisma-order.repository'

/** Columnas de `orders` (y de sus líneas) que necesita `payments` para cobrar. */
const ORDER_FOR_PAYMENT_SELECT = {
  id: true,
  number: true,
  status: true,
  paymentStatus: true,
  paymentMethod: true,
  totalArs: true,
  shippingCostArs: true,
  accessTokenHash: true,
  reservedUntil: true,
  createdAt: true,
  customerId: true,
  contactEmail: true,
  contactFirstName: true,
  contactLastName: true,
  contactPhone: true,
  items: {
    orderBy: { position: 'asc' },
    select: { id: true, name: true, quantity: true, totalArs: true },
  },
} satisfies Prisma.OrderSelect

/** Fila de `orders` con {@link ORDER_FOR_PAYMENT_SELECT}. */
type OrderForPaymentRow = Prisma.OrderGetPayload<{ select: typeof ORDER_FOR_PAYMENT_SELECT }>

/** Fila → lo que `payments` necesita del pedido. */
function toOrderForPayment(row: OrderForPaymentRow): OrderForPayment {
  return {
    id: row.id,
    number: row.number,
    status: row.status,
    paymentStatus: row.paymentStatus,
    paymentMethod: row.paymentMethod,
    totalArs: row.totalArs,
    shippingCostArs: row.shippingCostArs,
    accessTokenHash: row.accessTokenHash,
    reservedUntil: row.reservedUntil,
    createdAt: row.createdAt,
    customerId: row.customerId,
    contact: {
      email: row.contactEmail,
      firstName: row.contactFirstName,
      lastName: row.contactLastName,
      phone: row.contactPhone,
    },
    lines: row.items.map((item) => ({
      id: item.id,
      name: item.name,
      quantity: item.quantity,
      totalArs: item.totalArs,
    })),
  }
}

/**
 * {@link OrderPaymentsPort} con Prisma (Postgres): las escrituras de `payments` sobre pedidos.
 *
 * Marcar pagado es un `UPDATE orders … WHERE status = 'pending_payment'` en la misma transacción
 * que confirma las reservas (`on_hand − q`, `reserved − q`, por id de producto), el historial
 * (`actor: provider`) y los eventos del outbox: si la respuesta inmediata de la tarjeta y el
 * webhook del mismo pago llegan a la vez, solo uno confirma el stock. Después borra de la caché
 * el producto y su grupo, como al reservar.
 */
@Injectable()
export class PrismaOrderPaymentsAdapter implements OrderPaymentsPort {
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

  /** {@inheritDoc OrderPaymentsPort.findForPayment} */
  async findForPayment(number: string): Promise<OrderForPayment | null> {
    const row = await this.prisma.order.findUnique({
      where: { number },
      select: ORDER_FOR_PAYMENT_SELECT,
    })
    return row === null ? null : toOrderForPayment(row)
  }

  /** {@inheritDoc OrderPaymentsPort.findForPaymentById} */
  async findForPaymentById(orderId: string): Promise<OrderForPayment | null> {
    if (!UUID_PATTERN.test(orderId)) return null
    const row = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: ORDER_FOR_PAYMENT_SELECT,
    })
    return row === null ? null : toOrderForPayment(row)
  }

  /**
   * {@inheritDoc OrderPaymentsPort.markPaid}
   *
   * @throws {TypeError} En español, si `paidAt` no es una fecha válida.
   */
  async markPaid(orderId: string, paidAt: Date, events: OrderEvents): Promise<Order | null> {
    assertDate(paidAt, 'El momento del pago')
    const current = await this.read(orderId)
    if (current?.status !== 'pending_payment') return null
    const paid = markPaid(current, paidAt)
    const outcome = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.order.updateMany({
        where: { id: orderId, status: 'pending_payment' },
        data: { status: 'paid', paidAt, paymentStatus: 'approved' },
      })
      if (count === 0) return null
      const committed = await commitReservations(tx, orderId)
      await tx.orderStatusHistory.create({
        data: {
          id: newId(),
          orderId,
          fromStatus: 'pending_payment',
          toStatus: 'paid',
          actor: 'provider',
          note: null,
          createdAt: paidAt,
        },
      })
      for (const event of events(paid)) {
        await this.outbox.append(tx, createDomainEvent(event, paidAt))
      }
      return { keys: await catalogCacheKeys(tx, committed) }
    }, TRANSACTION_OPTIONS)
    if (outcome === null) return null
    await this.cache.del(...outcome.keys(await catalogCacheVersion(this.cache)))
    return paid
  }

  /**
   * {@inheritDoc OrderPaymentsPort.setPaymentStatus}
   *
   * Un id que no existe no cambia nada.
   *
   * @throws {RangeError} En español, si el estado no es un {@link PaymentStatus}.
   */
  async setPaymentStatus(orderId: string, status: PaymentStatus): Promise<void> {
    if (!isPaymentStatus(status)) {
      throw new RangeError(`El estado del pago "${String(status)}" no existe`)
    }
    if (!UUID_PATTERN.test(orderId)) return
    await this.prisma.order.updateMany({ where: { id: orderId }, data: { paymentStatus: status } })
  }

  /**
   * {@inheritDoc OrderPaymentsPort.markRefunded}
   *
   * @throws {TypeError} En español, si `at` no es una fecha válida.
   */
  async markRefunded(orderId: string, at: Date, events: OrderEvents): Promise<Order | null> {
    assertDate(at, 'El momento de la devolución')
    const current = await this.read(orderId)
    if (current === null || !isRefundable(current)) return null
    const refunded = markRefunded(current, at)
    const done = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.order.updateMany({
        where: { id: orderId, status: { in: [...REFUNDABLE_ORDER_STATUSES] } },
        data: { status: 'refunded', paymentStatus: 'refunded' },
      })
      if (count === 0) return false
      await tx.orderStatusHistory.create({
        data: {
          id: newId(),
          orderId,
          fromStatus: current.status,
          toStatus: 'refunded',
          actor: 'provider',
          note: null,
          createdAt: at,
        },
      })
      for (const event of events(refunded)) {
        await this.outbox.append(tx, createDomainEvent(event, at))
      }
      return true
    }, TRANSACTION_OPTIONS)
    return done ? refunded : null
  }

  /**
   * {@inheritDoc OrderPaymentsPort.listAwaitingPayment}
   *
   * @throws {TypeError} En español, si `cutoff` no es una fecha válida.
   * @throws {RangeError} En español, si `limit` no es un entero de 1 a 1000.
   */
  async listAwaitingPayment(cutoff: Date, limit: number): Promise<OrderForPayment[]> {
    assertDate(cutoff, 'El límite de reserved_until')
    assertBatchLimit(limit, 'El máximo de pedidos a conciliar')
    const rows = await this.prisma.order.findMany({
      where: {
        status: 'pending_payment',
        paymentStatus: { in: [...AWAITING_PAYMENT_STATUSES] },
        reservedUntil: { lte: cutoff },
      },
      orderBy: [
        { paymentReconciledAt: { sort: 'asc', nulls: 'first' } },
        { reservedUntil: 'asc' },
        { id: 'asc' },
      ],
      take: limit,
      select: ORDER_FOR_PAYMENT_SELECT,
    })
    return rows.map(toOrderForPayment)
  }

  /**
   * {@inheritDoc OrderPaymentsPort.markReconciled}
   *
   * @throws {TypeError} En español, si `at` no es una fecha válida.
   */
  async markReconciled(orderId: string, at: Date): Promise<void> {
    assertDate(at, 'La hora de la conciliación')
    if (!UUID_PATTERN.test(orderId)) return
    await this.prisma.order.updateMany({
      where: { id: orderId },
      data: { paymentReconciledAt: at },
    })
  }

  /**
   * Lee el pedido completo antes de abrir la transacción (dentro no se usa `include`: manda
   * consultas en paralelo por la misma conexión).
   */
  private async read(orderId: string): Promise<Order | null> {
    if (!UUID_PATTERN.test(orderId)) return null
    const row = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: ORDER_INCLUDE,
    })
    return row === null ? null : toOrder(row)
  }
}
