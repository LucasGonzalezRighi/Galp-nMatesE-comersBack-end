import { getQueueToken } from '@nestjs/bullmq'
import type { INestApplication } from '@nestjs/common'
import type { Queue } from 'bullmq'
import { randomUUID } from 'node:crypto'
import type { Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { seed } from '../../prisma/seed'
import {
  catalogCacheVersion,
  productGroupCacheKey,
  productSlugCacheKey,
} from '../../src/modules/catalog/infrastructure/catalog-cache'
import { CreateOrderCommand } from '../../src/modules/orders/application/commands/create-order.command'
import { ExpireOrdersCommand } from '../../src/modules/orders/application/commands/expire-orders.command'
import {
  ORDER_PAYMENTS_PORT,
  type OrderPaymentsPort,
} from '../../src/modules/orders/application/ports/order-payments.port'
import {
  ORDER_REPOSITORY,
  type OrderRepository,
} from '../../src/modules/orders/application/ports/order.repository.port'
import { QuoteCartQuery } from '../../src/modules/orders/application/queries/quote-cart.query'
import type { CartItem } from '../../src/modules/orders/domain/cart-line'
import { orderExpiredEvent } from '../../src/modules/orders/domain/order-events'
import type { Order } from '../../src/modules/orders/domain/order.entity'
import { ApplyProviderPaymentCommand } from '../../src/modules/payments/application/commands/apply-provider-payment.command'
import { OnOrderExpiredCommand } from '../../src/modules/payments/application/commands/on-order-expired.command'
import {
  PAYMENT_GATEWAY_PORT,
  type PaymentGatewayPort,
} from '../../src/modules/payments/application/ports/payment-gateway.port'
import {
  type NewPaymentAttempt,
  PAYMENT_REPOSITORY,
  type PaymentRepository,
} from '../../src/modules/payments/application/ports/payment.repository.port'
import {
  WEBHOOK_EVENT_REPOSITORY,
  type WebhookEventRepository,
} from '../../src/modules/payments/application/ports/webhook-event.repository.port'
import {
  WEBHOOK_QUEUE_PORT,
  type WebhookQueuePort,
} from '../../src/modules/payments/application/ports/webhook-queue.port'
import { releasedIdempotencyKey } from '../../src/modules/payments/application/release-attempt'
import type { ProviderPayment } from '../../src/modules/payments/domain/provider-payment'
import { PAYMENT_WEBHOOKS_QUEUE } from '../../src/modules/payments/infrastructure/payment-webhooks.queue'
import { PaymentsSweep } from '../../src/modules/payments/infrastructure/payments-sweep'
import { SimulatedGateway } from '../../src/modules/payments/infrastructure/simulated.gateway'
import { CACHE_PORT, type CachePort } from '../../src/shared/application/ports/cache.port'
import { newId } from '../../src/shared/domain/id'
import { OutboxRelay } from '../../src/shared/infrastructure/outbox/outbox.relay'
import { PrismaService } from '../../src/shared/infrastructure/prisma/prisma.service'
import { createApp } from '../support/app'
import { FixedClock } from '../support/clock'
import { startContainers, type TestContainers } from '../support/containers'
import { FakeGateway, simToken } from '../support/payments'

/** Cuero de un mate pedido suelto. */
const MATE_OPTIONS = { leather: 'Negro' } as const

/** Un minuto en milisegundos. */
const MINUTE = 60_000

/** Espera de las colas: el worker toma el job en milisegundos, pero Docker puede ir lento. */
const QUEUE_WAIT = { timeout: 15_000, interval: 200 } as const

describe('adaptadores de pagos (Postgres + Redis + BullMQ)', () => {
  let containers: TestContainers | undefined
  let app: INestApplication<Server> | undefined
  let customers = 0
  const previousEnv = { DATABASE_URL: process.env.DATABASE_URL, REDIS_URL: process.env.REDIS_URL }

  beforeAll(async () => {
    containers = await startContainers()
    process.env.DATABASE_URL = containers.databaseUrl
    process.env.REDIS_URL = containers.redisUrl
    app = await createApp()
    await seed(app.get(PrismaService))
  })

  afterAll(async () => {
    await app?.close()
    await containers?.stop()
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) Reflect.deleteProperty(process.env, key)
      else process.env[key] = value
    }
  })

  /** Saca un proveedor de la app ya armada. */
  function get<T>(token: symbol | string | (new (...args: never[]) => T)): T {
    if (app === undefined) throw new Error('La app no arrancó')
    return app.get<T>(token)
  }

  const prisma = () => get(PrismaService)
  const orders = () => get<OrderRepository>(ORDER_REPOSITORY)
  const payments = () => get<PaymentRepository>(PAYMENT_REPOSITORY)
  const webhookEvents = () => get<WebhookEventRepository>(WEBHOOK_EVENT_REPOSITORY)
  const cache = () => get<CachePort>(CACHE_PORT)
  const apply = () => get(ApplyProviderPaymentCommand)

  /** La pasarela de la app: sin `MP_*` es la simulada. */
  function gateway(): SimulatedGateway {
    const value = get<PaymentGatewayPort>(PAYMENT_GATEWAY_PORT)
    if (!(value instanceof SimulatedGateway)) throw new Error('La pasarela no es la simulada')
    return value
  }

  /** Id de un producto del seed por slug. */
  async function productId(slug: string): Promise<string> {
    const row = await prisma().product.findUniqueOrThrow({ where: { slug }, select: { id: true } })
    return row.id
  }

  /** `on_hand` y `reserved` de un producto. */
  async function stockOf(id: string): Promise<{ onHand: number; reserved: number }> {
    const row = await prisma().inventory.findUniqueOrThrow({ where: { productId: id } })
    return { onHand: row.onHand, reserved: row.reserved }
  }

  /** Crea un pedido con `CreateOrderCommand` (por defecto, una yerba) y lo lee del repositorio. */
  async function placeOrder(
    items?: CartItem[],
    paymentMethod: 'card' | 'mp_redirect' = 'card',
  ): Promise<Order> {
    const cart: CartItem[] = items ?? [
      {
        type: 'product',
        productId: await productId('yerba-canarias-1-kg'),
        quantity: 1,
        options: null,
      },
    ]
    customers += 1
    const quote = await get(QuoteCartQuery).execute(cart)
    const created = await get(CreateOrderCommand).execute(
      {
        customer: {
          email: `pagos-${String(customers)}@example.com`,
          firstName: 'Paz',
          lastName: 'Gil',
          phone: null,
        },
        shipping: { method: 'pickup', address: null },
        items: cart,
        paymentMethod,
        expectedTotalArs: quote.subtotalArs,
        website: null,
      },
      { customerId: null },
    )
    const order = await orders().findByNumber(created.order.number)
    if (order === null) throw new Error('No se guardó el pedido')
    return order
  }

  /** Intento nuevo para un pedido (clave idempotente nueva). */
  function attemptFor(order: Order, overrides: Partial<NewPaymentAttempt> = {}): NewPaymentAttempt {
    return {
      id: newId(),
      orderId: order.id,
      method: 'card',
      amountArs: order.totalArs,
      idempotencyKey: randomUUID(),
      payerEmail: 'paz@example.com',
      createdAt: new Date(),
      ...overrides,
    }
  }

  /** Un pago aprobado del pedido, como lo informaría Mercado Pago. */
  function approvedPayment(
    order: Order,
    overrides: Partial<ProviderPayment> = {},
  ): ProviderPayment {
    return {
      providerPaymentId: String(1_000_000_000 + Math.floor(Math.random() * 8_999_999_999)),
      status: 'approved',
      statusDetail: 'accredited',
      amountArs: order.totalArs,
      refundedArs: 0,
      installments: 1,
      paymentTypeId: 'credit_card',
      paymentMethodId: 'visa',
      cardLastFour: '3704',
      issuerId: null,
      externalReference: order.number,
      challengeUrl: null,
      approvedAt: new Date(),
      ...overrides,
    }
  }

  /** `orders.payment_status` tal como está en la base. */
  async function paymentStatusOf(order: Order): Promise<string> {
    const row = await prisma().order.findUniqueOrThrow({ where: { id: order.id } })
    return row.paymentStatus
  }

  describe('PrismaPaymentRepository', () => {
    it('startAttempt desactiva el activo anterior y deja payment_status none, en una transacción', async () => {
      const order = await placeOrder()
      const first = await payments().startAttempt(attemptFor(order))
      await payments().update(first.attempt.id, {
        status: 'action_required',
        challengeUrl: 'http://localhost:3001/desafio',
        providerPaymentId: '2000000001',
      })
      expect(await paymentStatusOf(order)).toBe('action_required')

      const second = await payments().startAttempt(attemptFor(order, { method: 'mp_redirect' }))

      expect(first.previous).toBeNull()
      expect(second.previous).toMatchObject({
        id: first.attempt.id,
        status: 'cancelled',
        isActive: false,
        challengeUrl: null,
        providerPaymentId: '2000000001',
      })
      expect(second.attempt).toMatchObject({
        orderId: order.id,
        method: 'mp_redirect',
        status: 'none',
        isActive: true,
        refundedArs: 0,
        provider: 'mercadopago',
      })
      expect(await paymentStatusOf(order)).toBe('none')
      expect(await payments().findActiveByOrder(order.id)).toMatchObject({ id: second.attempt.id })
      expect((await payments().listByOrder(order.id)).map((attempt) => attempt.id)).toEqual([
        first.attempt.id,
        second.attempt.id,
      ])
      expect(await prisma().payment.count({ where: { orderId: order.id, isActive: true } })).toBe(1)

      // Una clave repetida choca con el único y no cambia nada (rollback de la transacción).
      const repeated = attemptFor(order, { idempotencyKey: second.attempt.idempotencyKey })
      await expect(payments().startAttempt(repeated)).rejects.toThrow()
      expect(await payments().findActiveByOrder(order.id)).toMatchObject({ id: second.attempt.id })
    })

    it('update sincroniza payment_status solo si cambia el status y el intento es el vigente', async () => {
      const order = await placeOrder()
      const { attempt: first } = await payments().startAttempt(attemptFor(order))

      await payments().update(first.id, { status: 'pending', statusDetail: 'pending_contingency' })
      expect(await paymentStatusOf(order)).toBe('pending')

      // Sin cambio de status no toca el pedido.
      await prisma().order.update({
        where: { id: order.id },
        data: { paymentStatus: 'action_required' },
      })
      const same = await payments().update(first.id, { status: 'pending', installments: 3 })
      expect(same).toMatchObject({ status: 'pending', installments: 3 })
      expect(await paymentStatusOf(order)).toBe('action_required')

      // Un rechazo tardío del intento reemplazado no pisa al activo (Ruling B-45).
      const { attempt: second } = await payments().startAttempt(attemptFor(order))
      await payments().update(first.id, { status: 'rejected' })
      expect(await paymentStatusOf(order)).toBe('none')

      // El activo sí manda, con sus eventos en el outbox en la misma transacción.
      const event = {
        type: 'payment.rejected',
        aggregateType: 'order',
        aggregateId: order.number,
        payload: { orderId: order.id, number: order.number, paymentId: second.id },
      }
      const rejected = await payments().update(
        second.id,
        { status: 'rejected', isActive: false, statusDetail: 'cc_rejected_other_reason' },
        [event],
      )
      expect(rejected).toMatchObject({ status: 'rejected', isActive: false })
      expect(await paymentStatusOf(order)).toBe('rejected')
      expect(
        await prisma().outboxEvent.count({
          where: { type: 'payment.rejected', aggregateId: order.number },
        }),
      ).toBe(1)

      // Sin activo, el último intento que cambia vuelve a mandar.
      await payments().update(first.id, { status: 'cancelled' })
      expect(await paymentStatusOf(order)).toBe('cancelled')
    })

    it('un update que falla después de cambiar el intento no deja nada (rollback del intento y del pedido)', async () => {
      const order = await placeOrder()
      const { attempt } = await payments().startAttempt(attemptFor(order))
      await payments().update(attempt.id, { status: 'pending' })
      const invalidEvent = {
        type: '',
        aggregateType: 'order',
        aggregateId: order.number,
        payload: {},
      }

      await expect(
        payments().update(attempt.id, { status: 'rejected', isActive: false }, [invalidEvent]),
      ).rejects.toThrow('Un evento de dominio necesita type')

      expect(await payments().findById(attempt.id)).toMatchObject({
        status: 'pending',
        isActive: true,
      })
      expect(await paymentStatusOf(order)).toBe('pending')
    })

    it('busca por pago, preferencia e id; registra intentos inactivos y guarda devoluciones', async () => {
      const order = await placeOrder(undefined, 'mp_redirect')
      const { attempt } = await payments().startAttempt(
        attemptFor(order, { method: 'mp_redirect' }),
      )
      await payments().update(attempt.id, {
        providerPreferenceId: 'sim-pref-buscar',
        initPoint: 'http://localhost:3001/checkout',
        providerPaymentId: '2000000002',
      })

      expect(await payments().findByProviderPaymentId('mercadopago', '2000000002')).toMatchObject({
        id: attempt.id,
        initPoint: 'http://localhost:3001/checkout',
      })
      expect(await payments().findByPreferenceId('mercadopago', 'sim-pref-buscar')).toMatchObject({
        id: attempt.id,
      })
      expect(await payments().findByProviderPaymentId('mercadopago', '9999999999')).toBeNull()
      expect(await payments().findById('no-es-un-uuid')).toBeNull()
      expect(await payments().findActiveByOrder('no-es-un-uuid')).toBeNull()
      expect(await payments().listByOrder('no-es-un-uuid')).toEqual([])

      const recorded = await payments().recordAttempt(attemptFor(order, { method: 'mp_redirect' }))
      expect(recorded).toMatchObject({ status: 'none', isActive: false })
      expect(await payments().findActiveByOrder(order.id)).toMatchObject({ id: attempt.id })
      expect(await paymentStatusOf(order)).toBe('none')

      const refund = await payments().createRefund({
        id: newId(),
        paymentId: attempt.id,
        amountArs: order.totalArs,
        reason: 'manual',
        idempotencyKey: randomUUID(),
        createdAt: new Date(),
      })
      expect(refund).toMatchObject({ status: 'pending', providerRefundId: null, lastError: null })
      expect(await payments().findRefundByPayment(attempt.id, 'manual')).toEqual(refund)
      expect(await payments().findRefundByPayment(attempt.id, 'late_approval')).toBeNull()
      const failed = await payments().updateRefund(refund.id, {
        status: 'failed',
        lastError: 'Mercado Pago no respondió',
      })
      expect(failed).toMatchObject({ status: 'failed', lastError: 'Mercado Pago no respondió' })
      const approved = await payments().updateRefund(refund.id, {
        status: 'approved',
        providerRefundId: '777',
        lastError: null,
      })
      expect(approved).toMatchObject({
        status: 'approved',
        providerRefundId: '777',
        lastError: null,
      })
    })

    it('findByIdempotencyKey encuentra la clave exacta y no la original de una clave soltada', async () => {
      const order = await placeOrder()
      const input = attemptFor(order)
      const { attempt } = await payments().startAttempt(input)

      expect(await payments().findByIdempotencyKey(input.idempotencyKey)).toMatchObject({
        id: attempt.id,
        orderId: order.id,
      })

      const released = releasedIdempotencyKey(attempt)
      await payments().update(attempt.id, {
        status: 'cancelled',
        isActive: false,
        idempotencyKey: released,
      })
      expect(await payments().findByIdempotencyKey(input.idempotencyKey)).toBeNull()
      expect(await payments().findByIdempotencyKey(released)).toMatchObject({ id: attempt.id })
      expect(await payments().findByIdempotencyKey(randomUUID())).toBeNull()
    })
  })

  describe('PrismaWebhookEventRepository', () => {
    const notification = (eventId: string, receivedAt: Date) => ({
      provider: 'mercadopago' as const,
      eventId,
      type: 'payment',
      action: 'payment.updated',
      resourceId: '2000000003',
      signatureValid: true,
      payload: { id: eventId, type: 'payment', data: { id: '2000000003' } },
      receivedAt,
    })

    it('record deduplica por (provider, event_id); markProcessed cierra la notificación', async () => {
      const receivedAt = new Date()
      const first = await webhookEvents().record(notification('evento-dup', receivedAt))
      const again = await webhookEvents().record(notification('evento-dup', new Date()))

      expect(first.duplicate).toBe(false)
      expect(again).toEqual({ id: first.id, duplicate: true })
      expect(await prisma().webhookEvent.count({ where: { eventId: 'evento-dup' } })).toBe(1)
      expect(await webhookEvents().findById(first.id)).toEqual({
        ...notification('evento-dup', receivedAt),
        id: first.id,
        processedAt: null,
        attempts: 0,
      })

      const at = new Date()
      await webhookEvents().markProcessed(first.id, at, 'Mercado Pago no tiene el pago 2000000003.')
      const row = await prisma().webhookEvent.findUniqueOrThrow({ where: { id: first.id } })
      expect(row).toMatchObject({
        processedAt: at,
        attempts: 1,
        lastError: 'Mercado Pago no tiene el pago 2000000003.',
      })
      expect(await webhookEvents().findById('no-es-un-uuid')).toBeNull()
    })

    it('listUnprocessed trae las sin procesar de la ventana, de la más vieja a la más nueva', async () => {
      const base = new Date('2026-01-10T12:00:00.000Z').getTime()
      const at = (minutes: number) => new Date(base + minutes * MINUTE)
      const old = await webhookEvents().record(notification('ventana-vieja', at(-30)))
      const a = await webhookEvents().record(notification('ventana-a', at(-20)))
      const b = await webhookEvents().record(notification('ventana-b', at(-10)))
      const done = await webhookEvents().record(notification('ventana-hecha', at(-15)))
      await webhookEvents().record(notification('ventana-nueva', at(-1)))
      await webhookEvents().markProcessed(done.id, at(-14), null)

      const listed = await webhookEvents().listUnprocessed(at(-5), at(-25), 10)
      const limited = await webhookEvents().listUnprocessed(at(-5), at(-25), 1)

      expect(listed.map((event) => event.id)).toEqual([a.id, b.id])
      expect(limited.map((event) => event.id)).toEqual([a.id])
      expect(listed.map((event) => event.id)).not.toContain(old.id)
      await expect(webhookEvents().listUnprocessed(at(-5), at(-25), 0)).rejects.toThrow(RangeError)
    })
  })

  describe('máquina de estados con los adaptadores reales (Review Focus 3)', () => {
    it('un aprobado aplicado dos veces en paralelo confirma el stock una sola vez', async () => {
      const mate = await productId('mate-imperial-premium')
      const bombilla = await productId('bombillon-100-alpaca')
      const yerba = await productId('yerba-canarias-1-kg')
      const order = await placeOrder([
        { type: 'product', productId: mate, quantity: 2, options: MATE_OPTIONS },
        {
          type: 'kit',
          mateId: mate,
          bombillaId: bombilla,
          yerbaId: yerba,
          leather: 'Negro',
          quantity: 1,
        },
      ])
      const before = {
        mate: await stockOf(mate),
        bombilla: await stockOf(bombilla),
        yerba: await stockOf(yerba),
      }
      const version = await catalogCacheVersion(cache())
      const keys = [
        productSlugCacheKey('mate-imperial-premium', version),
        productSlugCacheKey('bombillon-100-alpaca', version),
        productSlugCacheKey('yerba-canarias-1-kg', version),
        productGroupCacheKey('mate', version),
        productGroupCacheKey('bombilla', version),
        productGroupCacheKey('yerba', version),
      ]
      for (const key of keys) await cache().set(key, { viejo: true }, 60)
      const { attempt } = await payments().startAttempt(attemptFor(order))
      const payment = approvedPayment(order)

      // La respuesta inmediata de la tarjeta y la conciliación del mismo pago, a la vez.
      const results = await Promise.all([
        apply().execute(payment, { attemptId: attempt.id, source: 'card' }),
        apply().execute(payment, { attemptId: attempt.id, source: 'webhook' }),
      ])

      expect(results.map((result) => result?.status)).toEqual(['approved', 'approved'])
      expect(await stockOf(mate)).toEqual({
        onHand: before.mate.onHand - 3,
        reserved: before.mate.reserved - 3,
      })
      expect(await stockOf(bombilla)).toEqual({
        onHand: before.bombilla.onHand - 1,
        reserved: before.bombilla.reserved - 1,
      })
      expect(await stockOf(yerba)).toEqual({
        onHand: before.yerba.onHand - 1,
        reserved: before.yerba.reserved - 1,
      })
      for (const key of keys) expect(await cache().get(key)).toBeNull()
      const row = await prisma().order.findUniqueOrThrow({
        where: { id: order.id },
        include: { reservations: true },
      })
      expect(row).toMatchObject({ status: 'paid', paymentStatus: 'approved' })
      expect(row.reservations.map((reservation) => reservation.status)).toEqual([
        'committed',
        'committed',
        'committed',
      ])
      // Un solo order.paid y un solo payment.approved: el segundo update ve el intento ya
      // aprobado (fila bloqueada) y no repite los eventos.
      const paidEvents = { type: 'order.paid', aggregateId: order.number }
      const approvedEvents = { type: 'payment.approved', aggregateId: attempt.id }
      expect(await prisma().outboxEvent.count({ where: paidEvents })).toBe(1)
      expect(await prisma().outboxEvent.count({ where: approvedEvents })).toBe(1)
      expect(await payments().findById(attempt.id)).toMatchObject({
        status: 'approved',
        isActive: false,
        providerPaymentId: payment.providerPaymentId,
      })
      expect(await prisma().refund.count({ where: { paymentId: attempt.id } })).toBe(0)

      // Después del pago, vencer no libera nada.
      const later = new Date(order.reservedUntil.getTime() + MINUTE)
      expect(await orders().expire(order.id, later, (o) => [orderExpiredEvent(o)])).toBeNull()
      expect(await stockOf(mate)).toEqual({
        onHand: before.mate.onHand - 3,
        reserved: before.mate.reserved - 3,
      })
    })

    it('un aprobado después de vencer el pedido se devuelve (late_approval) una sola vez', async () => {
      const order = await placeOrder()
      const { attempt } = await payments().startAttempt(attemptFor(order))
      const later = new Date(order.reservedUntil.getTime() + MINUTE)
      expect(await orders().expire(order.id, later, (o) => [orderExpiredEvent(o)])).not.toBeNull()
      const payment = approvedPayment(order)
      const refundsBefore = gateway().callsTo('refundPayment').length

      await apply().execute(payment, { attemptId: attempt.id, source: 'webhook' })
      await apply().execute(payment, { attemptId: null, source: 'webhook' })

      const refunds = await prisma().refund.findMany({ where: { paymentId: attempt.id } })
      expect(refunds).toEqual([
        expect.objectContaining({
          reason: 'late_approval',
          status: 'approved',
          amountArs: order.totalArs,
        }),
      ])
      const calls = gateway().callsTo('refundPayment').slice(refundsBefore)
      expect(calls).toEqual([[payment.providerPaymentId, refunds[0]?.idempotencyKey]])
      expect(await prisma().order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({
        status: 'expired',
      })
    })
  })

  describe('colas', () => {
    it('un job de payment-webhooks procesa una notificación registrada', async () => {
      const order = await placeOrder()
      const { attempt } = await payments().startAttempt(attemptFor(order))
      const forPayment = await get<OrderPaymentsPort>(ORDER_PAYMENTS_PORT).findForPaymentById(
        order.id,
      )
      if (forPayment === null) throw new Error('No se encontró el pedido para cobrar')
      const pending = await gateway().createCardPayment({
        order: forPayment,
        idempotencyKey: attempt.idempotencyKey,
        token: simToken('CONT'),
        paymentMethodId: 'visa',
        issuerId: null,
        installments: 1,
        payer: { email: 'paz@example.com', identification: { type: 'DNI', number: '12345678' } },
        notificationUrl: null,
        statementDescriptor: 'GALPON MATES',
      })
      await apply().execute(pending, { attemptId: attempt.id, source: 'card' })
      expect(await paymentStatusOf(order)).toBe('pending')
      gateway().remember({ ...pending, status: 'approved', statusDetail: 'accredited' })
      const { id } = await webhookEvents().record({
        provider: 'mercadopago',
        eventId: `notificacion-${pending.providerPaymentId}`,
        type: 'payment',
        action: 'payment.updated',
        resourceId: pending.providerPaymentId,
        signatureValid: true,
        payload: { type: 'payment', data: { id: pending.providerPaymentId } },
        receivedAt: new Date(),
      })
      await get<Queue>(getQueueToken(PAYMENT_WEBHOOKS_QUEUE)).waitUntilReady()

      await expect(get<WebhookQueuePort>(WEBHOOK_QUEUE_PORT).enqueue(id)).resolves.toBe(true)

      await vi.waitFor(async () => {
        const row = await prisma().webhookEvent.findUniqueOrThrow({ where: { id } })
        expect(row.processedAt).toBeInstanceOf(Date)
      }, QUEUE_WAIT)
      expect(await prisma().order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({
        status: 'paid',
        paymentStatus: 'approved',
      })
      const job = await get<Queue>(getQueueToken(PAYMENT_WEBHOOKS_QUEUE)).getJob(id)
      expect(job?.name).toBe('webhook.process')
      expect(job?.opts.attempts).toBe(5)
    })

    it('el consumidor del outbox cancela el intento de un pedido vencido y vence la preferencia', async () => {
      const order = await placeOrder(undefined, 'mp_redirect')
      const { attempt } = await payments().startAttempt(
        attemptFor(order, { method: 'mp_redirect' }),
      )
      const preferenceId = `sim-pref-${newId()}`
      await payments().update(attempt.id, { providerPreferenceId: preferenceId })
      const later = new Date(order.reservedUntil.getTime() + MINUTE)
      expect(await orders().expire(order.id, later, (o) => [orderExpiredEvent(o)])).not.toBeNull()

      expect(await get(OutboxRelay).runOnce()).toBeGreaterThan(0)

      await vi.waitFor(async () => {
        expect(await payments().findById(attempt.id)).toMatchObject({
          status: 'cancelled',
          isActive: false,
        })
      }, QUEUE_WAIT)
      expect(gateway().callsTo('expirePreference')).toContainEqual([preferenceId])
    })

    it('un aprobado parcial y un rechazado: el pedido vence por el job y el consumidor del outbox devuelve el aprobado (late_approval) una sola vez', async () => {
      const order = await placeOrder(undefined, 'mp_redirect')
      const { attempt } = await payments().startAttempt(
        attemptFor(order, { method: 'mp_redirect' }),
      )
      const partialArs = Math.floor(order.totalArs / 3)
      const checkoutPro = { paymentTypeId: 'account_money', paymentMethodId: 'account_money' }
      const partial = approvedPayment(order, { ...checkoutPro, amountArs: partialArs })
      await apply().execute(partial, { attemptId: null, source: 'webhook' })
      expect(await paymentStatusOf(order)).toBe('pending')
      const rejected = approvedPayment(order, {
        ...checkoutPro,
        status: 'rejected',
        statusDetail: 'cc_rejected_other_reason',
        amountArs: order.totalArs - partialArs,
        approvedAt: null,
      })
      await apply().execute(rejected, { attemptId: null, source: 'webhook' })
      expect(await paymentStatusOf(order)).toBe('rejected')
      await prisma().order.update({
        where: { id: order.id },
        data: { reservedUntil: new Date(Date.now() - MINUTE) },
      })
      expect(await get(ExpireOrdersCommand).expireOne(order.id)).not.toBeNull()
      const refundCalls = () =>
        gateway()
          .callsTo('refundPayment')
          .filter(([providerPaymentId]) => providerPaymentId === partial.providerPaymentId)

      expect(await get(OutboxRelay).runOnce()).toBeGreaterThan(0)

      await vi.waitFor(async () => {
        expect(
          await prisma().refund.findMany({
            where: { paymentId: attempt.id },
            select: { reason: true, status: true, amountArs: true },
          }),
        ).toEqual([{ reason: 'late_approval', status: 'approved', amountArs: partialArs }])
      }, QUEUE_WAIT)
      await get(OnOrderExpiredCommand).execute(order.id)

      expect(await prisma().refund.count({ where: { payment: { orderId: order.id } } })).toBe(1)
      expect(refundCalls()).toHaveLength(1)
      expect(await prisma().order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({
        status: 'expired',
      })
    })

    it('el barrido de pagos retoma una notificación sin procesar de hace más de 5 minutos', async () => {
      const { id } = await webhookEvents().record({
        provider: 'mercadopago',
        eventId: `orden-comercial-${newId()}`,
        type: 'topic_merchant_order_wh',
        action: null,
        resourceId: '123',
        signatureValid: true,
        payload: { type: 'topic_merchant_order_wh' },
        receivedAt: new Date(Date.now() - 10 * MINUTE),
      })

      const result = await get(PaymentsSweep).runOnce()

      expect(result.reprocess.processed).toBeGreaterThanOrEqual(1)
      expect(result.reprocess.failed).toBe(0)
      const row = await prisma().webhookEvent.findUniqueOrThrow({ where: { id } })
      expect(row.processedAt).toBeInstanceOf(Date)
    })
  })

  describe('createApp({ gateway })', () => {
    it('reemplaza la pasarela en los casos de uso', async () => {
      const fake = new FakeGateway(new FixedClock())
      const order = await placeOrder(undefined, 'mp_redirect')
      const { attempt } = await payments().startAttempt(
        attemptFor(order, { method: 'mp_redirect' }),
      )
      await payments().update(attempt.id, { providerPreferenceId: 'sim-pref-reemplazo' })
      const other = await createApp({ gateway: fake })
      try {
        expect(other.get(PAYMENT_GATEWAY_PORT)).toBe(fake)

        await other.get(OnOrderExpiredCommand).execute(order.id)

        expect(fake.callsTo('expirePreference')).toEqual([['sim-pref-reemplazo']])
        expect(gateway().callsTo('expirePreference')).not.toContainEqual(['sim-pref-reemplazo'])
      } finally {
        await other.close()
      }
    })
  })
})
