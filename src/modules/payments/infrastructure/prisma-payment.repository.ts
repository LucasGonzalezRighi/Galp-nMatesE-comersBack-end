import { Inject, Injectable } from '@nestjs/common'

import type { Prisma } from '../../../generated/prisma/client'
import { CLOCK, type Clock } from '../../../shared/domain/clock'
import { createDomainEvent, type NewDomainEvent } from '../../../shared/domain/domain-event'
import { OutboxRepository } from '../../../shared/infrastructure/outbox/outbox.repository'
import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service'
import { UUID_PATTERN } from '../../orders/infrastructure/order.mapper'
import { TRANSACTION_OPTIONS } from '../../orders/infrastructure/prisma-order.repository'
import type {
  NewPaymentAttempt,
  NewRefund,
  PaymentAttemptPatch,
  PaymentRepository,
  Refund,
} from '../application/ports/payment.repository.port'
import {
  ACTIVE_PAYMENT_STATUSES,
  MAX_PAYMENT_ATTEMPTS_PER_ORDER,
  type PaymentAttempt,
  type PaymentProvider,
} from '../domain/payment-attempt'
import { PaymentAttemptsExhaustedError } from '../domain/payments-errors'
import { toPaymentAttempt, toPaymentUpdate, toRefund } from './payment.mapper'

/** Prefijo de la clave del bloqueo consultivo de pagos de un pedido (`hashtext` de prefijo + id). */
const ORDER_PAYMENT_LOCK_PREFIX = 'payments:order:'

/**
 * Transacción que sostiene el bloqueo de pagos de un pedido: hasta 5 s para conseguir conexión y
 * 60 s para terminar (adentro puede haber llamadas a Mercado Pago, de hasta 10 s cada una).
 */
const ORDER_LOCK_TRANSACTION_OPTIONS = { maxWait: 5_000, timeout: 60_000 } as const

/** Orden de los intentos de un pedido: del más viejo al más nuevo (con el id como desempate). */
const OLDEST_FIRST = [
  { createdAt: 'asc' },
  { id: 'asc' },
] satisfies Prisma.PaymentOrderByWithRelationInput[]

/** Columnas de un intento nuevo (nace en `none`). */
function newAttemptData(
  input: NewPaymentAttempt,
  isActive: boolean,
): Prisma.PaymentUncheckedCreateInput {
  return {
    id: input.id,
    orderId: input.orderId,
    method: input.method,
    status: 'none',
    amountArs: input.amountArs,
    idempotencyKey: input.idempotencyKey,
    payerEmail: input.payerEmail,
    isActive,
    createdAt: input.createdAt,
  }
}

/**
 * {@link PaymentRepository} con Prisma (tablas `payments` y `refunds`).
 *
 * `orders.payment_status` se escribe con el mismo `tx` que el intento (Ruling B-45, excepción
 * explícita y acotada al ADR 0001: solo esa columna, en `startAttempt` y `update`); así no queda
 * nunca un pedido en `pending` con su intento ya `rejected`/`cancelled` (que no vencería). El
 * resto de las escrituras sobre pedidos pasa por `OrderPaymentsPort`.
 *
 * `update` bloquea la fila del intento (`SELECT … FOR UPDATE`) antes de leerla: si la respuesta
 * inmediata de la tarjeta y el webhook del mismo pago llegan a la vez, el segundo ve el status que
 * dejó el primero, no sincroniza de nuevo el pedido y no repite los eventos del outbox (los
 * escribió quien hizo la transición).
 */
@Injectable()
export class PrismaPaymentRepository implements PaymentRepository {
  /**
   * @param prisma - Cliente de Prisma de la app.
   * @param outbox - Outbox (los eventos de `update` van en la misma transacción).
   * @param clock - Reloj (`occurred_at` de esos eventos).
   */
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** {@inheritDoc PaymentRepository.startAttempt} */
  async startAttempt(
    input: NewPaymentAttempt,
  ): Promise<{ attempt: PaymentAttempt; previous: PaymentAttempt | null }> {
    return this.prisma.$transaction(async (tx) => {
      // El pedido bloqueado: dos intentos a la vez no pasan los dos el tope.
      await tx.$queryRaw`SELECT id FROM orders WHERE id = ${input.orderId}::uuid FOR UPDATE`
      const attempts = await tx.payment.count({ where: { orderId: input.orderId } })
      if (attempts >= MAX_PAYMENT_ATTEMPTS_PER_ORDER) throw new PaymentAttemptsExhaustedError()
      const [previous] = await tx.payment.updateManyAndReturn({
        where: { orderId: input.orderId, isActive: true },
        data: { status: 'cancelled', isActive: false, challengeUrl: null },
      })
      const created = await tx.payment.create({ data: newAttemptData(input, true) })
      await tx.order.update({ where: { id: input.orderId }, data: { paymentStatus: 'none' } })
      return {
        attempt: toPaymentAttempt(created),
        previous: previous === undefined ? null : toPaymentAttempt(previous),
      }
    }, TRANSACTION_OPTIONS)
  }

  /** {@inheritDoc PaymentRepository.recordAttempt} */
  async recordAttempt(input: NewPaymentAttempt): Promise<PaymentAttempt> {
    return toPaymentAttempt(
      await this.prisma.payment.create({ data: newAttemptData(input, false) }),
    )
  }

  /** {@inheritDoc PaymentRepository.findById} */
  async findById(id: string): Promise<PaymentAttempt | null> {
    if (!UUID_PATTERN.test(id)) return null
    const row = await this.prisma.payment.findUnique({ where: { id } })
    return row === null ? null : toPaymentAttempt(row)
  }

  /** {@inheritDoc PaymentRepository.findByIdempotencyKey} */
  async findByIdempotencyKey(key: string): Promise<PaymentAttempt | null> {
    const row = await this.prisma.payment.findUnique({ where: { idempotencyKey: key } })
    return row === null ? null : toPaymentAttempt(row)
  }

  /** {@inheritDoc PaymentRepository.findActiveByOrder} */
  async findActiveByOrder(orderId: string): Promise<PaymentAttempt | null> {
    if (!UUID_PATTERN.test(orderId)) return null
    const row = await this.prisma.payment.findFirst({ where: { orderId, isActive: true } })
    return row === null ? null : toPaymentAttempt(row)
  }

  /** {@inheritDoc PaymentRepository.findByProviderPaymentId} */
  async findByProviderPaymentId(
    provider: PaymentProvider,
    providerPaymentId: string,
  ): Promise<PaymentAttempt | null> {
    const row = await this.prisma.payment.findUnique({
      where: { provider_providerPaymentId: { provider, providerPaymentId } },
    })
    return row === null ? null : toPaymentAttempt(row)
  }

  /** {@inheritDoc PaymentRepository.findByPreferenceId} */
  async findByPreferenceId(
    provider: PaymentProvider,
    preferenceId: string,
  ): Promise<PaymentAttempt | null> {
    const row = await this.prisma.payment.findFirst({
      where: { provider, providerPreferenceId: preferenceId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    })
    return row === null ? null : toPaymentAttempt(row)
  }

  /** {@inheritDoc PaymentRepository.listByOrder} */
  async listByOrder(orderId: string): Promise<PaymentAttempt[]> {
    if (!UUID_PATTERN.test(orderId)) return []
    const rows = await this.prisma.payment.findMany({ where: { orderId }, orderBy: OLDEST_FIRST })
    return rows.map(toPaymentAttempt)
  }

  /**
   * {@inheritDoc PaymentRepository.update}
   *
   * Si otro proceso ya dejó el intento en el status del parche, no escribe los `events` (ya los
   * escribió quien hizo la transición).
   *
   * @throws {Error} En español, si el intento no existe.
   */
  async update(
    id: string,
    patch: PaymentAttemptPatch,
    events: readonly NewDomainEvent[] = [],
  ): Promise<PaymentAttempt> {
    if (!UUID_PATTERN.test(id)) throw new Error(`No existe el intento de pago ${id}`)
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM payments WHERE id = ${id}::uuid FOR UPDATE`
      const current = await tx.payment.findUnique({ where: { id } })
      if (current === null) throw new Error(`No existe el intento de pago ${id}`)
      const updated = await tx.payment.update({ where: { id }, data: toPaymentUpdate(patch) })
      const transitioned = updated.status !== current.status
      if (transitioned && (current.isActive || (await this.othersActive(tx, current)) === 0)) {
        await tx.order.update({
          where: { id: current.orderId },
          data: { paymentStatus: updated.status },
        })
      }
      if (transitioned || patch.status === undefined) {
        const occurredAt = this.clock.now()
        for (const event of events) {
          await this.outbox.append(tx, createDomainEvent(event, occurredAt))
        }
      }
      return toPaymentAttempt(updated)
    }, TRANSACTION_OPTIONS)
  }

  /** {@inheritDoc PaymentRepository.cancelActive} */
  async cancelActive(id: string): Promise<PaymentAttempt | null> {
    if (!UUID_PATTERN.test(id)) return null
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM payments WHERE id = ${id}::uuid FOR UPDATE`
      const { count } = await tx.payment.updateMany({
        where: { id, isActive: true, status: { in: [...ACTIVE_PAYMENT_STATUSES] } },
        data: { status: 'cancelled', isActive: false, challengeUrl: null },
      })
      if (count === 0) return null
      const cancelled = await tx.payment.findUniqueOrThrow({ where: { id } })
      // Estaba activo, así que manda en orders.payment_status (como en `update`).
      await tx.order.update({
        where: { id: cancelled.orderId },
        data: { paymentStatus: cancelled.status },
      })
      return toPaymentAttempt(cancelled)
    }, TRANSACTION_OPTIONS)
  }

  /**
   * {@inheritDoc PaymentRepository.serializeByOrder}
   *
   * La transacción solo sostiene el bloqueo (`work` usa sus propias conexiones del pool): el
   * bloqueo consultivo no choca con las escrituras de `work`, así que no se traba consigo mismo.
   */
  async serializeByOrder<T>(orderId: string, work: () => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${ORDER_PAYMENT_LOCK_PREFIX + orderId}))`
      return work()
    }, ORDER_LOCK_TRANSACTION_OPTIONS)
  }

  /** {@inheritDoc PaymentRepository.createRefund} */
  async createRefund(input: NewRefund): Promise<Refund> {
    const row = await this.prisma.refund.create({
      data: {
        id: input.id,
        paymentId: input.paymentId,
        amountArs: input.amountArs,
        reason: input.reason,
        idempotencyKey: input.idempotencyKey,
        status: 'pending',
        createdAt: input.createdAt,
      },
    })
    return toRefund(row)
  }

  /**
   * {@inheritDoc PaymentRepository.updateRefund}
   *
   * @throws {Error} Si la devolución no existe (error de Prisma).
   */
  async updateRefund(
    id: string,
    patch: {
      providerRefundId?: string | null
      status?: Refund['status']
      lastError?: string | null
    },
  ): Promise<Refund> {
    const data: Prisma.RefundUncheckedUpdateInput = {}
    if (patch.providerRefundId !== undefined) data.providerRefundId = patch.providerRefundId
    if (patch.status !== undefined) data.status = patch.status
    if (patch.lastError !== undefined) data.lastError = patch.lastError
    return toRefund(await this.prisma.refund.update({ where: { id }, data }))
  }

  /** {@inheritDoc PaymentRepository.findRefundByPayment} */
  async findRefundByPayment(paymentId: string, reason: Refund['reason']): Promise<Refund | null> {
    if (!UUID_PATTERN.test(paymentId)) return null
    const row = await this.prisma.refund.findFirst({
      where: { paymentId, reason },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    })
    return row === null ? null : toRefund(row)
  }

  /** Otros intentos activos del mismo pedido (sin contar este). */
  private othersActive(
    tx: Prisma.TransactionClient,
    attempt: { id: string; orderId: string },
  ): Promise<number> {
    return tx.payment.count({
      where: { orderId: attempt.orderId, isActive: true, id: { not: attempt.id } },
    })
  }
}
