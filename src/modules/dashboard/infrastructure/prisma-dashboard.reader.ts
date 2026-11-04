import { Injectable } from '@nestjs/common'

import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service'
import {
  type DashboardReader,
  type DashboardSnapshot,
  type LowStockProduct,
  SALES_TIME_ZONE,
} from '../application/ports/dashboard-reader.port'
import type { PaymentIssue } from '../domain/payment-alerts'

/** Fila de las cifras sueltas (las sumas de `int` son `bigint` en Postgres). */
interface CountsRow {
  salesTodayArs: bigint
  salesLast7DaysArs: bigint
  ordersToShip: number
  pendingReviews: number
  unreadMessages: number
}

/** Fila de un pedido con algo de pago para mirar. */
interface PaymentIssueRow {
  number: string
  paymentStatus: string
  totalArs: number
  createdAt: Date
  unsettledRefundsArs: number[]
}

/**
 * Pasa una suma de Postgres a `number`.
 *
 * @throws {RangeError} En español, si no entra en un entero seguro de JavaScript.
 */
function toSafeNumber(name: string, value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < 0n) {
    throw new RangeError(
      `La suma ${name} del resumen no entra en un entero seguro (${String(value)}).`,
    )
  }
  return Number(value)
}

/**
 * Lector del resumen con SQL directo (Ruling B-78, ADR 0001: lee tablas de `orders`, `payments`,
 * `catalog`, `settings`, `reviews` y `support`, y no escribe nada). Tres consultas en paralelo:
 *
 * - las cifras sueltas en una sola sentencia (ventas por `paid_at` en Buenos Aires de los pedidos
 *   `paid`, `preparing`, `shipped` y `delivered`; para despachar, `paid` y `preparing`; reseñas
 *   `pending`; mensajes con `read_at` nulo);
 * - el stock bajo: publicados con disponible (`on_hand − reserved`, 0 sin fila de `inventory`,
 *   Ruling B-71) menor o igual a `settings.low_stock_threshold`, por disponible y por nombre con
 *   `es-x-icu`; sin la fila de ajustes la lista sale vacía;
 * - los pedidos con `payment_status` `charged_back` o `in_dispute` o con alguna devolución
 *   `pending` o `failed`, del más nuevo al más viejo, con esas devoluciones por `created_at`.
 */
@Injectable()
export class PrismaDashboardReader implements DashboardReader {
  /** @param prisma - Cliente de Prisma. */
  constructor(private readonly prisma: PrismaService) {}

  /**
   * {@inheritDoc DashboardReader.read}
   *
   * @throws {TypeError} En español, si `now` no es una fecha válida.
   * @throws {RangeError} En español, si una suma de ventas no entra en un entero seguro.
   */
  async read(now: Date): Promise<DashboardSnapshot> {
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
      throw new TypeError('La hora del resumen tiene que ser una fecha válida.')
    }
    const [counts, lowStock, paymentIssues] = await Promise.all([
      this.readCounts(now),
      this.readLowStock(),
      this.readPaymentIssues(),
    ])
    return {
      salesTodayArs: toSafeNumber('salesTodayArs', counts.salesTodayArs),
      salesLast7DaysArs: toSafeNumber('salesLast7DaysArs', counts.salesLast7DaysArs),
      ordersToShip: counts.ordersToShip,
      lowStock,
      pendingReviews: counts.pendingReviews,
      unreadMessages: counts.unreadMessages,
      paymentIssues,
    }
  }

  /** Ventas de hoy y de los últimos 7 días, pedidos para despachar, reseñas y mensajes. */
  private async readCounts(now: Date): Promise<CountsRow> {
    const rows = await this.prisma.$queryRaw<CountsRow[]>`
      WITH today AS (
        SELECT (${now}::timestamptz AT TIME ZONE ${SALES_TIME_ZONE})::date AS day
      ),
      sold AS (
        SELECT o.total_ars, (o.paid_at AT TIME ZONE ${SALES_TIME_ZONE})::date AS day
        FROM orders o, today t
        WHERE o.status IN ('paid', 'preparing', 'shipped', 'delivered')
          AND (o.paid_at AT TIME ZONE ${SALES_TIME_ZONE})::date BETWEEN t.day - 6 AND t.day
      )
      SELECT
        (SELECT COALESCE(sum(s.total_ars), 0) FROM sold s, today t WHERE s.day = t.day)::bigint
          AS "salesTodayArs",
        (SELECT COALESCE(sum(s.total_ars), 0) FROM sold s)::bigint AS "salesLast7DaysArs",
        (SELECT count(*) FROM orders WHERE status IN ('paid', 'preparing'))::int
          AS "ordersToShip",
        (SELECT count(*) FROM reviews WHERE status = 'pending')::int AS "pendingReviews",
        (SELECT count(*) FROM contact_messages WHERE read_at IS NULL)::int AS "unreadMessages"`
    const row = rows[0]
    if (row === undefined) throw new Error('La consulta de las cifras del resumen no dio filas.')
    return row
  }

  /** Publicados con poco stock disponible. */
  private readLowStock(): Promise<LowStockProduct[]> {
    return this.prisma.$queryRaw<LowStockProduct[]>`
      SELECT p.id, p.name, COALESCE(i.on_hand - i.reserved, 0)::int AS stock
      FROM products p
      JOIN settings s ON s.id = 1
      LEFT JOIN inventory i ON i.product_id = p.id
      WHERE p.status = 'published'
        AND COALESCE(i.on_hand - i.reserved, 0) <= s.low_stock_threshold
      ORDER BY stock ASC, p.name COLLATE "es-x-icu" ASC, p.sequence ASC`
  }

  /** Pedidos con contracargo, mediación o devoluciones sin aprobar. */
  private async readPaymentIssues(): Promise<PaymentIssue[]> {
    const rows = await this.prisma.$queryRaw<PaymentIssueRow[]>`
      SELECT
        o.number,
        o.payment_status::text AS "paymentStatus",
        o.total_ars AS "totalArs",
        o.created_at AS "createdAt",
        COALESCE(
          array_agg(r.amount_ars ORDER BY r.created_at, r.id) FILTER (WHERE r.id IS NOT NULL),
          '{}'
        )::int[] AS "unsettledRefundsArs"
      FROM orders o
      LEFT JOIN payments pay ON pay.order_id = o.id
      LEFT JOIN refunds r ON r.payment_id = pay.id AND r.status IN ('pending', 'failed')
      WHERE o.payment_status IN ('charged_back', 'in_dispute') OR r.id IS NOT NULL
      GROUP BY o.id
      ORDER BY o.created_at DESC, o.number DESC`
    return rows.map((row) => ({
      orderNumber: row.number,
      paymentStatus: row.paymentStatus,
      totalArs: row.totalArs,
      createdAt: row.createdAt,
      unsettledRefundsArs: row.unsettledRefundsArs,
    }))
  }
}
