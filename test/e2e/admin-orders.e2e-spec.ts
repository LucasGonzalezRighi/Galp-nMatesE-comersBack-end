import type { INestApplication } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import type { Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { seed } from '../../prisma/seed'
import { SEED_ADMIN } from '../../prisma/seed-data/admin'
import type {
  AdminOrderPageView,
  OrderView,
} from '../../src/modules/orders/application/read-models'
import { PrismaService } from '../../src/shared/infrastructure/prisma/prisma.service'
import { createApp } from '../support/app'
import { startContainers, type TestContainers } from '../support/containers'
import { call, type CallOptions, type HttpMethod, newJar } from '../support/http'
import { mateLine, ordersHttp } from '../support/orders-http'
import { simToken } from '../support/payments'

const MINUTE = 60_000
const RESERVATION_MS = 30 * MINUTE

/** Pedido creado por HTTP: número, id y token. */
interface PlacedOrder {
  id: string
  number: string
  token: string
}

/** Evento del outbox, como se lee de la base. */
interface OutboxRow {
  type: string
  aggregateId: string
  payload: unknown
}

const STATUS_MESSAGE =
  'El estado tiene que ser pending_payment, paid, preparing, shipped, delivered, cancelled, expired, refunded.'
const PAYMENT_STATUS_MESSAGE =
  'El estado del pago tiene que ser none, pending, action_required, approved, rejected, cancelled, refunded, partially_refunded, in_dispute, charged_back.'

describe('pedidos del dashboard (HTTP + Postgres + Redis)', () => {
  let containers: TestContainers | undefined
  let app: INestApplication<Server> | undefined
  let yerba = ''
  let customers = 0
  const previousEnv = {
    DATABASE_URL: process.env.DATABASE_URL,
    REDIS_URL: process.env.REDIS_URL,
  }
  const admin = newJar()

  beforeAll(async () => {
    containers = await startContainers()
    process.env.DATABASE_URL = containers.databaseUrl
    process.env.REDIS_URL = containers.redisUrl
    app = await createApp()
    await seed(prisma())
    const login = await http('post', '/admin/auth/login', { body: SEED_ADMIN })
    expect(login.status).toBe(200)
    admin.csrf = (login.body as { csrfToken: string }).csrfToken
    const row = await prisma().product.findUniqueOrThrow({
      where: { slug: 'yerba-canarias-1-kg' },
      select: { id: true },
    })
    yerba = row.id
    // Muchos pedidos de una yerba: stock de sobra antes de la primera cotización.
    await prisma().inventory.update({ where: { productId: yerba }, data: { onHand: 500 } })
  })

  afterAll(async () => {
    await app?.close()
    await containers?.stop()
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) Reflect.deleteProperty(process.env, key)
      else process.env[key] = value
    }
  })

  function server(): Server {
    if (app === undefined) throw new Error('La app no arrancó')
    return app.getHttpServer()
  }

  function prisma(): PrismaService {
    if (app === undefined) throw new Error('La app no arrancó')
    return app.get(PrismaService)
  }

  /** Pedido como el dashboard (sesión de admin y CSRF, salvo que se pida otra cosa). */
  function http(method: HttpMethod, path: string, options: CallOptions = {}) {
    return call(server(), admin, method, path, options)
  }

  /** Pedido sin sesión. */
  function anonymous(method: HttpMethod, path: string, options: CallOptions = {}) {
    return call(server(), newJar(), method, path, options)
  }

  const { orderBody, createdOrder } = ordersHttp(server)

  /** Pedido nuevo de una yerba, a nombre de `firstName lastName`. */
  async function placeOrder(firstName = 'Lucía', lastName = 'Pérez'): Promise<PlacedOrder> {
    customers += 1
    const email = `admin-pedidos${String(customers)}@ejemplo.com`
    const body = await orderBody([mateLine(yerba)], email)
    const { order, orderToken } = await createdOrder(newJar(), {
      ...body,
      customer: { email, firstName, lastName, phone: null },
    })
    const row = await prisma().order.findUniqueOrThrow({
      where: { number: order.number },
      select: { id: true },
    })
    return { id: row.id, number: order.number, token: orderToken }
  }

  /** Paga el pedido con una tarjeta del simulador (`APRO` aprueba, `CONT` queda pendiente). */
  async function payByCard(order: PlacedOrder, holder: 'APRO' | 'CONT'): Promise<void> {
    const response = await anonymous('post', `/orders/${order.number}/payments/mercadopago/card`, {
      headers: { 'X-Order-Token': order.token, 'Idempotency-Key': randomUUID() },
      body: {
        token: simToken(holder),
        paymentMethodId: 'visa',
        issuerId: null,
        installments: 1,
        payer: {
          email: 'lucia@ejemplo.com',
          identification: { type: 'DNI', number: '12.345.678' },
        },
      },
    })
    expect(response.status, JSON.stringify(response.body)).toBe(200)
  }

  /** Abre un Checkout Pro: deja un intento activo en `none`. */
  async function openPreference(order: PlacedOrder): Promise<void> {
    const response = await anonymous(
      'post',
      `/orders/${order.number}/payments/mercadopago/preference`,
      { headers: { 'X-Order-Token': order.token, 'Idempotency-Key': randomUUID() } },
    )
    expect(response.status, JSON.stringify(response.body)).toBe(200)
  }

  /** `POST /admin/orders/{number}/status` con el cuerpo completo. */
  function changeStatus(number: string, body: Record<string, unknown>, options: CallOptions = {}) {
    return http('post', `/admin/orders/${number}/status`, {
      body: { carrier: null, trackingNumber: null, note: null, ...body },
      ...options,
    })
  }

  async function listOrders(query: string): Promise<AdminOrderPageView> {
    const response = await http('get', `/admin/orders${query}`)
    expect(response.status, JSON.stringify(response.body)).toBe(200)
    return response.body as AdminOrderPageView
  }

  async function outbox(): Promise<OutboxRow[]> {
    return prisma().outboxEvent.findMany({
      orderBy: { id: 'asc' },
      select: { type: true, aggregateId: true, payload: true },
    })
  }

  /** Corre una escritura y devuelve la respuesta y los eventos nuevos del outbox. */
  async function withEvents<T>(
    write: () => Promise<T>,
  ): Promise<{ result: T; events: OutboxRow[] }> {
    const before = (await outbox()).length
    const result = await write()
    return { result, events: (await outbox()).slice(before) }
  }

  it('lista de a 20, del más nuevo al más viejo, con estados repetidos, pago y búsqueda sin acentos', async () => {
    const bruno: string[] = []
    for (let index = 0; index < 22; index += 1)
      bruno.push((await placeOrder('Bruno', 'Gómez')).number)
    const lucia = await placeOrder('Lucía', 'Pérez')
    await prisma().order.updateMany({
      where: { number: { in: bruno.slice(0, 12) } },
      data: { status: 'paid', paymentStatus: 'approved' },
    })
    await prisma().order.updateMany({
      where: { number: { in: bruno.slice(12) } },
      data: { status: 'preparing', paymentStatus: 'approved' },
    })
    const newestFirst = [...bruno].reverse()

    const first = await listOrders('?status=paid&status=preparing')
    const second = await listOrders('?status=paid&status=preparing&page=2')
    const paid = await listOrders('?status=paid')
    const byName = await listOrders('?q=lucia%20perez')
    const byAccents = await listOrders(`?q=${encodeURIComponent('  LUCÍA   PÉREZ ')}`)
    const combined = await listOrders('?paymentStatus=approved&q=gomez&status=preparing')

    expect(first).toMatchObject({ page: 1, pageSize: 20, total: 22 })
    expect(first.items.map((order) => order.number)).toEqual(newestFirst.slice(0, 20))
    expect(new Set(first.items.map((order) => order.status))).toEqual(
      new Set(['paid', 'preparing']),
    )
    expect(second).toMatchObject({ page: 2, pageSize: 20, total: 22 })
    expect(second.items.map((order) => order.number)).toEqual(newestFirst.slice(20))
    expect(paid.total).toBe(12)
    expect(byName.items.map((order) => order.number)).toEqual([lucia.number])
    expect(byName.items[0]?.customer).toMatchObject({ firstName: 'Lucía', lastName: 'Pérez' })
    expect(byAccents.items.map((order) => order.number)).toEqual([lucia.number])
    expect(combined.total).toBe(10)
  })

  it('valida la query con los textos del mock, todos juntos y en su orden', async () => {
    const long = 'a'.repeat(101)

    const status = await http('get', '/admin/orders?status=paid&status=enviado')
    const payment = await http('get', '/admin/orders?paymentStatus=x')
    const text = await http('get', `/admin/orders?q=${long}`)
    const pageSize = await http('get', '/admin/orders?pageSize=20')
    const all = await http('get', `/admin/orders?status=enviado&q=${long}&paymentStatus=x&page=0`)
    const unauthorized = await anonymous('get', '/admin/orders')

    expect(status.status).toBe(422)
    expect(status.body).toMatchObject({
      errors: [{ field: 'status', code: 'invalid_value', message: STATUS_MESSAGE }],
    })
    expect(payment.body).toMatchObject({
      errors: [{ field: 'paymentStatus', code: 'invalid_value', message: PAYMENT_STATUS_MESSAGE }],
    })
    expect(text.body).toMatchObject({
      errors: [
        { field: 'q', code: 'too_big', message: 'El texto no puede pasar de 100 caracteres.' },
      ],
    })
    expect(pageSize.status).toBe(422)
    expect(pageSize.body).toMatchObject({
      errors: [
        { field: 'pageSize', code: 'unrecognized_key', message: 'Este campo no está permitido.' },
      ],
    })
    expect(
      (all.body as { errors: { field: string }[] }).errors.map((error) => error.field),
    ).toEqual(['page', 'paymentStatus', 'q', 'status'])
    expect(unauthorized.status).toBe(401)
  })

  it('el detalle es el mismo Order que ve el cliente; 404 y 422 con los textos del mock', async () => {
    const order = await placeOrder()

    const detail = await http('get', `/admin/orders/${order.number}`)
    const customerView = await anonymous('get', `/orders/${order.number}`, {
      headers: { 'X-Order-Token': order.token },
    })
    const missing = await http('get', '/admin/orders/GLP-99999')
    const malformed = await http('get', '/admin/orders/GLP-1')
    const unauthorized = await anonymous('get', `/admin/orders/${order.number}`)

    expect(detail.status).toBe(200)
    expect(detail.body).toEqual(customerView.body)
    expect(missing.status).toBe(404)
    expect(missing.body).toMatchObject({ type: 'not_found', detail: 'No existe ese pedido.' })
    expect(malformed.status).toBe(422)
    expect(malformed.body).toMatchObject({
      errors: [
        {
          field: 'number',
          message: 'El número de pedido tiene que ser GLP- y cinco dígitos.',
        },
      ],
    })
    expect(unauthorized.status).toBe(401)
  })

  it('pagado → en preparación → despachado (recortado, en shipments) → entregado, con el historial del admin', async () => {
    const order = await placeOrder()
    await payByCard(order, 'APRO')

    const preparing = await changeStatus(order.number, {
      status: 'preparing',
      note: '  Lo arma Bruno  ',
    })
    const { result: shipped, events: shippedEvents } = await withEvents(() =>
      changeStatus(order.number, {
        status: 'shipped',
        carrier: ' Andreani ',
        trackingNumber: ' AND123456789 ',
        note: '  ',
      }),
    )
    const shipment = await prisma().shipment.findUniqueOrThrow({ where: { orderId: order.id } })
    const twice = await changeStatus(order.number, {
      status: 'shipped',
      carrier: 'Andreani',
      trackingNumber: 'AND123456789',
    })
    const { result: delivered, events: deliveredEvents } = await withEvents(() =>
      changeStatus(order.number, { status: 'delivered' }),
    )
    const deliveredShipment = await prisma().shipment.findUniqueOrThrow({
      where: { orderId: order.id },
    })
    const history = await prisma().orderStatusHistory.findMany({
      where: { orderId: order.id, actor: 'admin' },
      orderBy: { createdAt: 'asc' },
      select: { fromStatus: true, toStatus: true, note: true },
    })

    expect(preparing.status, JSON.stringify(preparing.body)).toBe(200)
    expect((preparing.body as OrderView).history.at(-1)).toMatchObject({
      status: 'preparing',
      note: 'Lo arma Bruno',
    })
    expect(shipped.status).toBe(200)
    expect(shipped.body).toMatchObject({
      status: 'shipped',
      tracking: { carrier: 'Andreani', number: 'AND123456789' },
    })
    expect((shipped.body as OrderView).history.at(-1)).toMatchObject({
      status: 'shipped',
      note: null,
    })
    expect(shipment).toMatchObject({
      carrier: 'Andreani',
      trackingNumber: 'AND123456789',
      deliveredAt: null,
    })
    expect(shipment.shippedAt).toBeInstanceOf(Date)
    expect(shippedEvents).toEqual([
      {
        type: 'order.shipped',
        aggregateId: order.number,
        payload: {
          orderId: order.id,
          number: order.number,
          carrier: 'Andreani',
          trackingNumber: 'AND123456789',
        },
      },
    ])
    expect(twice.status).toBe(409)
    expect(twice.body).toMatchObject({
      type: 'invalid_status_transition',
      title: 'Transición inválida',
      detail: 'El pedido está despachado: no puede pasar a despachado.',
    })
    expect(delivered.status).toBe(200)
    expect(delivered.body).toMatchObject({ status: 'delivered' })
    expect(deliveredShipment.deliveredAt).toBeInstanceOf(Date)
    expect(deliveredEvents).toEqual([
      {
        type: 'order.delivered',
        aggregateId: order.number,
        payload: { orderId: order.id, number: order.number },
      },
    ])
    expect(history).toEqual([
      { fromStatus: 'paid', toStatus: 'preparing', note: 'Lo arma Bruno' },
      { fromStatus: 'preparing', toStatus: 'shipped', note: null },
      { fromStatus: 'shipped', toStatus: 'delivered', note: null },
    ])
  })

  it('un pedido pagado o vencido no se cancela (409 con el texto del mock)', async () => {
    const paid = await placeOrder()
    await payByCard(paid, 'APRO')
    const late = await placeOrder()
    const reservedUntil = new Date(Date.now() - MINUTE)
    const createdAt = new Date(reservedUntil.getTime() - RESERVATION_MS)
    await prisma().order.update({
      where: { id: late.id },
      data: { createdAt, placedAt: createdAt, reservedUntil },
    })

    const { result: paidCancel, events } = await withEvents(() =>
      changeStatus(paid.number, { status: 'cancelled' }),
    )
    const lateCancel = await changeStatus(late.number, { status: 'cancelled' })

    expect(paidCancel.status).toBe(409)
    expect(paidCancel.body).toMatchObject({
      type: 'invalid_status_transition',
      detail: 'El pedido está pagado: no puede pasar a cancelado.',
    })
    expect(events).toEqual([])
    expect(lateCancel.status).toBe(409)
    expect(lateCancel.body).toMatchObject({
      type: 'invalid_status_transition',
      detail: 'El pedido está vencido: no puede pasar a cancelado.',
    })
  })

  it('cancelar con el intento none: pago cancelled, reserva liberada, cancelled_at, historial y eventos (Review Focus 3)', async () => {
    const order = await placeOrder()
    await openPreference(order)
    const attempt = await prisma().payment.findFirstOrThrow({
      where: { orderId: order.id, isActive: true },
      select: { id: true, status: true },
    })
    const before = await prisma().inventory.findUniqueOrThrow({ where: { productId: yerba } })

    const { result, events } = await withEvents(() =>
      changeStatus(order.number, { status: 'cancelled' }),
    )
    const row = await prisma().order.findUniqueOrThrow({ where: { id: order.id } })
    const after = await prisma().inventory.findUniqueOrThrow({ where: { productId: yerba } })
    const reservations = await prisma().stockReservation.findMany({
      where: { orderId: order.id },
      select: { status: true },
    })
    const payment = await prisma().payment.findUniqueOrThrow({ where: { id: attempt.id } })
    const history = await prisma().orderStatusHistory.findMany({
      where: { orderId: order.id, actor: 'admin' },
      select: { fromStatus: true, toStatus: true, note: true },
    })

    expect(attempt.status).toBe('none')
    expect(result.status, JSON.stringify(result.body)).toBe(200)
    expect(result.body).toMatchObject({ status: 'cancelled', paymentStatus: 'cancelled' })
    expect((result.body as OrderView).history.at(-1)).toMatchObject({
      status: 'cancelled',
      note: null,
    })
    expect(row.cancelledAt).toBeInstanceOf(Date)
    expect(row.paymentStatus).toBe('cancelled')
    expect(after.reserved).toBe(before.reserved - 1)
    expect(reservations).toEqual([{ status: 'released' }])
    expect(payment).toMatchObject({ status: 'cancelled', isActive: false })
    expect(history).toEqual([{ fromStatus: 'pending_payment', toStatus: 'cancelled', note: null }])
    expect(events).toEqual([
      {
        type: 'order.cancelled',
        aggregateId: order.number,
        payload: { orderId: order.id, number: order.number, cancelledAttemptId: attempt.id },
      },
      {
        type: 'storefront.stale',
        aggregateId: 'order.cancelled',
        payload: { reason: 'order.cancelled', tags: ['products', 'combos'] },
      },
    ])
  })

  it('cancelar sin intentos deja el pago en none y cancelledAttemptId en null', async () => {
    const order = await placeOrder()

    const { result, events } = await withEvents(() =>
      changeStatus(order.number, { status: 'cancelled', note: 'Lo pidió por WhatsApp' }),
    )

    expect(result.status).toBe(200)
    expect(result.body).toMatchObject({ status: 'cancelled', paymentStatus: 'none' })
    expect(events[0]?.payload).toEqual({
      orderId: order.id,
      number: order.number,
      cancelledAttemptId: null,
    })
  })

  it('con el intento pending responde 409 payment_in_progress y no toca nada (Review Focus 3)', async () => {
    const order = await placeOrder()
    await payByCard(order, 'CONT')
    const before = await prisma().inventory.findUniqueOrThrow({ where: { productId: yerba } })

    const { result, events } = await withEvents(() =>
      changeStatus(order.number, { status: 'cancelled' }),
    )
    const row = await prisma().order.findUniqueOrThrow({ where: { id: order.id } })
    const after = await prisma().inventory.findUniqueOrThrow({ where: { productId: yerba } })
    const reservations = await prisma().stockReservation.findMany({
      where: { orderId: order.id },
      select: { status: true },
    })
    const adminHistory = await prisma().orderStatusHistory.count({
      where: { orderId: order.id, actor: 'admin' },
    })

    expect(result.status).toBe(409)
    expect(result.body).toMatchObject({
      type: 'payment_in_progress',
      title: 'Hay un pago en curso',
      status: 409,
      detail: 'Hay un pago en curso: esperá a que se resuelva para cancelar el pedido.',
    })
    expect(events).toEqual([])
    expect(row).toMatchObject({
      status: 'pending_payment',
      paymentStatus: 'pending',
      cancelledAt: null,
    })
    expect(after.reserved).toBe(before.reserved)
    expect(reservations).toEqual([{ status: 'active' }])
    expect(adminHistory).toBe(0)
  })

  it('valida el cuerpo (estricto como el contrato), pide CSRF y un cuerpo inválido da 422 antes que 404', async () => {
    const order = await placeOrder()
    await payByCard(order, 'APRO')

    const noTracking = await changeStatus(order.number, { status: 'shipped' })
    const notTarget = await changeStatus(order.number, { status: 'paid' })
    const missing = await http('post', `/admin/orders/${order.number}/status`, {
      body: { status: 'preparing' },
    })
    const carrierOnCancel = await changeStatus(order.number, {
      status: 'cancelled',
      carrier: 'Andreani',
    })
    const invalidToMissing = await changeStatus('GLP-99999', { status: 'shipped' })
    const missingOrder = await changeStatus('GLP-99999', { status: 'preparing' })
    const withoutCsrf = await changeStatus(order.number, { status: 'preparing' }, { csrf: false })
    const withoutSession = await anonymous('post', `/admin/orders/${order.number}/status`, {
      body: { status: 'preparing', carrier: null, trackingNumber: null, note: null },
    })

    expect(noTracking.status).toBe(422)
    expect(noTracking.body).toMatchObject({
      errors: [
        { field: 'carrier', message: 'Requerido' },
        { field: 'trackingNumber', message: 'Requerido' },
      ],
    })
    expect(notTarget.body).toEqual(
      expect.objectContaining({
        errors: [
          { field: 'status', code: 'invalid_value', message: 'Elegí el estado nuevo del pedido' },
        ],
      }),
    )
    expect(missing.status).toBe(422)
    expect((missing.body as { errors: { field: string; message: string }[] }).errors).toEqual([
      { field: 'carrier', code: 'required', message: 'Requerido' },
      { field: 'trackingNumber', code: 'required', message: 'Requerido' },
      { field: 'note', code: 'required', message: 'Requerido' },
    ])
    expect(carrierOnCancel.body).toMatchObject({
      errors: [{ field: 'carrier', message: 'Solo se completa al despachar el pedido' }],
    })
    expect(invalidToMissing.status).toBe(422)
    expect(missingOrder.status).toBe(404)
    expect(missingOrder.body).toMatchObject({ detail: 'No existe ese pedido.' })
    expect(withoutCsrf.status).toBe(403)
    expect(withoutSession.status).toBe(401)
    await expect(
      prisma().order.findUniqueOrThrow({ where: { id: order.id }, select: { status: true } }),
    ).resolves.toEqual({ status: 'paid' })
  })
})
