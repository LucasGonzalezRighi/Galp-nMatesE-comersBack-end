import type { INestApplication } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import type { Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { seed } from '../../prisma/seed'
import { SEED_ADMIN } from '../../prisma/seed-data/admin'
import type { OrderStatus } from '../../src/generated/prisma/client'
import type { DashboardSummaryView } from '../../src/modules/dashboard/application/queries/get-dashboard-summary.query'
import { PrismaService } from '../../src/shared/infrastructure/prisma/prisma.service'
import { createApp } from '../support/app'
import { FixedClock } from '../support/clock'
import { startContainers, type TestContainers } from '../support/containers'
import { call, newJar } from '../support/http'
import { mateLine, ordersHttp } from '../support/orders-http'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** "Ahora" de la prueba: miércoles 4 de noviembre, 12:00 en Buenos Aires (UTC−3). */
const NOW = new Date('2026-11-04T15:00:00.000Z')

/** Precio de la Yerba Canarias 1 kg en el seed; cada pedido suma el envío a domicilio (6500). */
const YERBA_PRICE_ARS = 9999
const HOME_SHIPPING_ARS = 6500

/** Pedido creado por HTTP. */
interface PlacedOrder {
  id: string
  number: string
  totalArs: number
}

describe('resumen del dashboard (HTTP + Postgres + Redis)', () => {
  let containers: TestContainers | undefined
  let app: INestApplication<Server> | undefined
  const clock = new FixedClock(NOW)
  const admin = newJar()
  const ids = { coquito: '', galleta: '', yerba: '' }
  let customers = 0
  const previousEnv = {
    DATABASE_URL: process.env.DATABASE_URL,
    REDIS_URL: process.env.REDIS_URL,
  }

  beforeAll(async () => {
    containers = await startContainers()
    process.env.DATABASE_URL = containers.databaseUrl
    process.env.REDIS_URL = containers.redisUrl
    app = await createApp({ clock })
    await seed(prisma())
    const login = await call(server(), admin, 'post', '/admin/auth/login', { body: SEED_ADMIN })
    expect(login.status).toBe(200)
    admin.csrf = (login.body as { csrfToken: string }).csrfToken
    ids.coquito = await productId('mate-coquito-criollo')
    ids.galleta = await productId('mate-galleta')
    ids.yerba = await productId('yerba-canarias-1-kg')
    // Muchos pedidos de una yerba: stock de sobra (no entra en el stock bajo).
    await prisma().inventory.update({ where: { productId: ids.yerba }, data: { onHand: 500 } })
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

  async function productId(slug: string): Promise<string> {
    const row = await prisma().product.findUniqueOrThrow({ where: { slug }, select: { id: true } })
    return row.id
  }

  /** `GET /admin/dashboard/summary` con la sesión de admin (tiene que dar 200). */
  async function summary(): Promise<DashboardSummaryView> {
    const response = await call(server(), admin, 'get', '/admin/dashboard/summary')
    expect(response.status, JSON.stringify(response.body)).toBe(200)
    return response.body as DashboardSummaryView
  }

  const { orderBody, createdOrder } = ordersHttp(server)

  /** Pedido nuevo por HTTP (queda `pending_payment` y reserva su stock). */
  async function placeOrder(items: Record<string, unknown>[]): Promise<PlacedOrder> {
    customers += 1
    const email = `resumen${String(customers)}@ejemplo.com`
    const { order } = await createdOrder(newJar(), await orderBody(items, email))
    const row = await prisma().order.findUniqueOrThrow({
      where: { number: order.number },
      select: { id: true },
    })
    return { id: row.id, number: order.number, totalArs: order.totalArs }
  }

  /** Pedido de `quantity` yerbas pasado directo en la base a `status`, pagado en `paidAt`. */
  async function soldOrder(quantity: number, status: OrderStatus, paidAt: Date) {
    const order = await placeOrder([mateLine(ids.yerba, quantity)])
    expect(order.totalArs).toBe(quantity * YERBA_PRICE_ARS + HOME_SHIPPING_ARS)
    await prisma().order.update({ where: { id: order.id }, data: { status, paidAt } })
    return order
  }

  it('sin sesión de admin → 401', async () => {
    const response = await call(server(), newJar(), 'get', '/admin/dashboard/summary')

    expect(response.status).toBe(401)
  })

  it('con el seed y sin pedidos: todo en cero y el stock bajo del seed (umbral 3)', async () => {
    expect(await summary()).toEqual({
      salesTodayArs: 0,
      salesLast7DaysArs: 0,
      ordersToShip: 0,
      lowStock: [
        { id: ids.galleta, name: 'Mate Galleta', stock: 0 },
        { id: ids.coquito, name: 'Mate Coquito Criollo', stock: 2 },
      ],
      pendingReviews: 0,
      unreadMessages: 0,
      paymentAlerts: [],
    })
  })

  it('un pedido que reserva los 2 Mate Coquito Criollo lo deja con 0 disponible y, a igual stock, por nombre (Review Focus 1)', async () => {
    await placeOrder([mateLine(ids.coquito, 2)])

    expect((await summary()).lowStock).toEqual([
      { id: ids.coquito, name: 'Mate Coquito Criollo', stock: 0 },
      { id: ids.galleta, name: 'Mate Galleta', stock: 0 },
    ])
    expect(
      await prisma().inventory.findUniqueOrThrow({ where: { productId: ids.coquito } }),
    ).toMatchObject({ onHand: 2, reserved: 2 })
  })

  it('solo cuenta los publicados y un producto sin fila de inventario cuenta 0', async () => {
    const bombilla = await prisma().product.findFirstOrThrow({
      where: { status: 'published', category: { group: 'bombilla' } },
      orderBy: { sequence: 'asc' },
      include: { inventory: true },
    })
    const onHand = bombilla.inventory?.onHand ?? 0
    expect(onHand).toBeGreaterThan(3)
    await prisma().inventory.delete({ where: { productId: bombilla.id } })
    await prisma().product.update({ where: { id: ids.galleta }, data: { status: 'archived' } })

    try {
      expect((await summary()).lowStock).toEqual([
        { id: bombilla.id, name: bombilla.name, stock: 0 },
        { id: ids.coquito, name: 'Mate Coquito Criollo', stock: 0 },
      ])
    } finally {
      await prisma().inventory.create({ data: { productId: bombilla.id, onHand } })
      await prisma().product.update({ where: { id: ids.galleta }, data: { status: 'published' } })
    }
  })

  it('ventas por el día de paid_at en Buenos Aires: hoy y los 6 días anteriores, sin devueltos', async () => {
    // 1 yerba: pagado hoy (cuenta en las dos y para despachar).
    const today = await soldOrder(1, 'paid', new Date(NOW.getTime() - HOUR))
    // 2: el 4 a las 02:30 UTC es el 3 a las 23:30 en Buenos Aires: ayer (en preparación).
    const yesterday = await soldOrder(2, 'preparing', new Date('2026-11-04T02:30:00.000Z'))
    // 3: 29 de octubre a las 00:30 en Buenos Aires, el primer día de la ventana.
    const firstDay = await soldOrder(3, 'delivered', new Date('2026-10-29T03:30:00.000Z'))
    // 4: 28 de octubre a las 23:30 en Buenos Aires (29 en UTC): afuera.
    await soldOrder(4, 'shipped', new Date('2026-10-29T02:30:00.000Z'))
    // 5: hace 8 días: en ninguna.
    await soldOrder(5, 'delivered', new Date(NOW.getTime() - 8 * DAY))
    // 6: pagado hoy pero devuelto: en ninguna.
    await soldOrder(6, 'refunded', new Date(NOW.getTime() - HOUR))

    const result = await summary()

    expect(result.salesTodayArs).toBe(today.totalArs)
    expect(result.salesLast7DaysArs).toBe(today.totalArs + yesterday.totalArs + firstDay.totalArs)
    expect(result.ordersToShip).toBe(2)
  })

  it('alertas de pago: del pedido más nuevo al más viejo; en cada uno, el estado del pago y después cada devolución sin aprobar por fecha', async () => {
    const tenDaysAgo = new Date(NOW.getTime() - 10 * DAY)
    // El contracargo se crea primero (número más bajo) pero con la fecha más nueva.
    const chargedBack = await soldOrder(1, 'delivered', tenDaysAgo)
    const refunded = await soldOrder(1, 'delivered', tenDaysAgo)
    const disputed = await soldOrder(1, 'delivered', tenDaysAgo)
    await prisma().order.update({
      where: { id: chargedBack.id },
      data: { paymentStatus: 'charged_back', createdAt: new Date(NOW.getTime() - HOUR) },
    })
    await prisma().order.update({
      where: { id: refunded.id },
      data: { paymentStatus: 'approved', createdAt: new Date(NOW.getTime() - 2 * HOUR) },
    })
    await prisma().order.update({
      where: { id: disputed.id },
      data: { paymentStatus: 'in_dispute', createdAt: new Date(NOW.getTime() - 3 * HOUR) },
    })
    const payment = await prisma().payment.create({
      data: {
        orderId: refunded.id,
        method: 'card',
        status: 'approved',
        amountArs: 60000,
        idempotencyKey: randomUUID(),
        isActive: false,
      },
    })
    // Se insertan en otro orden que el de sus fechas: manda `created_at`.
    const refunds = [
      { amountArs: 12000, status: 'pending', reason: 'late_approval', minutesAgo: 70 },
      { amountArs: 5000, status: 'approved', reason: 'manual', minutesAgo: 80 },
      { amountArs: 46499, status: 'failed', reason: 'duplicate_payment', minutesAgo: 90 },
    ] as const
    for (const { amountArs, status, reason, minutesAgo } of refunds) {
      await prisma().refund.create({
        data: {
          paymentId: payment.id,
          amountArs,
          status,
          reason,
          idempotencyKey: randomUUID(),
          createdAt: new Date(NOW.getTime() - minutesAgo * MINUTE),
        },
      })
    }

    expect((await summary()).paymentAlerts).toEqual([
      {
        orderNumber: chargedBack.number,
        kind: 'charged_back',
        message:
          'Contracargo por $16.499: el cliente desconoció el pago. Revisalo en Mercado Pago.',
      },
      {
        orderNumber: refunded.number,
        kind: 'duplicate_payment',
        message: 'Se aprobó un segundo pago de $46.499. Devolvelo desde Mercado Pago.',
      },
      {
        orderNumber: refunded.number,
        kind: 'duplicate_payment',
        message: 'Se aprobó un segundo pago de $12.000. Devolvelo desde Mercado Pago.',
      },
      {
        orderNumber: disputed.number,
        kind: 'in_dispute',
        message: 'Mediación abierta por $16.499. Respondé desde Mercado Pago.',
      },
    ])
  })

  it('un contacto suma un mensaje sin leer y una reseña nueva una pendiente', async () => {
    const contact = await call(server(), newJar(), 'post', '/contact', {
      body: {
        name: 'Lucía Gómez',
        email: 'lucia.gomez@example.com',
        orderNumber: null,
        reason: 'Otro',
        message: '¿Hacen envíos a Tierra del Fuego?',
        website: null,
      },
    })
    const review = await call(server(), newJar(), 'post', '/products/mate-galleta/reviews', {
      body: { rating: 5, authorName: 'Lucía', text: 'Hermoso, llegó impecable.', website: null },
    })
    expect(contact.status, JSON.stringify(contact.body)).toBe(202)
    expect(review.status, JSON.stringify(review.body)).toBe(202)

    const result = await summary()

    expect(result.unreadMessages).toBe(1)
    expect(result.pendingReviews).toBe(1)
  })

  it('vence los pedidos atrasados antes de leer: la reserva del Coquito vuelve al stock', async () => {
    clock.advance(31 * MINUTE)

    expect((await summary()).lowStock).toEqual([
      { id: ids.galleta, name: 'Mate Galleta', stock: 0 },
      { id: ids.coquito, name: 'Mate Coquito Criollo', stock: 2 },
    ])
    expect(
      await prisma().inventory.findUniqueOrThrow({ where: { productId: ids.coquito } }),
    ).toMatchObject({ onHand: 2, reserved: 0 })
  })
})
