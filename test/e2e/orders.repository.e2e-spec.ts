import { getQueueToken } from '@nestjs/bullmq'
import type { INestApplication } from '@nestjs/common'
import type { Queue } from 'bullmq'
import { createHash } from 'node:crypto'
import type { Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { seed } from '../../prisma/seed'
import {
  productGroupCacheKey,
  productSlugCacheKey,
} from '../../src/modules/catalog/infrastructure/cached-product.repository'
import {
  CUSTOMER_REPOSITORY,
  type CustomerRepository,
} from '../../src/modules/identity/application/ports/customer.repository.port'
import { CreateOrderCommand } from '../../src/modules/orders/application/commands/create-order.command'
import {
  CUSTOMER_DIRECTORY_PORT,
  type CustomerDirectoryPort,
} from '../../src/modules/orders/application/ports/customer-directory.port'
import {
  ORDER_REPOSITORY,
  type OrderRepository,
} from '../../src/modules/orders/application/ports/order.repository.port'
import {
  PRODUCT_CATALOG_PORT,
  type ProductCatalogPort,
} from '../../src/modules/orders/application/ports/product-catalog.port'
import { GetOrderQuery } from '../../src/modules/orders/application/queries/get-order.query'
import { QuoteCartQuery } from '../../src/modules/orders/application/queries/quote-cart.query'
import type { CartItem, CartItemOptions } from '../../src/modules/orders/domain/cart-line'
import { orderCreatedEvent, orderExpiredEvent } from '../../src/modules/orders/domain/order-events'
import {
  type Order,
  type OrderDraft,
  reservedUntilFor,
} from '../../src/modules/orders/domain/order.entity'
import {
  ORDER_EXPIRATION_QUEUE,
  ORDER_EXPIRE_JOB,
} from '../../src/modules/orders/infrastructure/order-expiration.queue'
import { OrderExpirationSweep } from '../../src/modules/orders/infrastructure/order-expiration.sweep'
import { CACHE_PORT, type CachePort } from '../../src/shared/application/ports/cache.port'
import { newId } from '../../src/shared/domain/id'
import { PrismaService } from '../../src/shared/infrastructure/prisma/prisma.service'
import { createApp } from '../support/app'
import { startContainers, type TestContainers } from '../support/containers'

/** Producto del seed, con lo que hace falta para armar un pedido a mano. */
interface SeedProductRef {
  id: string
  slug: string
  name: string
  priceArs: number
}

/** Eventos de creación y de vencimiento, como los arman los casos de uso. */
const createdEvents = (order: Order) => [orderCreatedEvent(order)]
const expiredEvents = (order: Order) => [orderExpiredEvent(order)]

/** Cuero y virola de un mate pedido suelto. */
const MATE_OPTIONS: CartItemOptions = { leather: 'Negro', ferrule: 'Alpaca cincelada' }

/** Un minuto en milisegundos. */
const MINUTE = 60_000

describe('adaptadores de pedidos (Postgres + Redis + BullMQ)', () => {
  let containers: TestContainers | undefined
  let app: INestApplication<Server> | undefined
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
  const directory = () => get<CustomerDirectoryPort>(CUSTOMER_DIRECTORY_PORT)
  const cache = () => get<CachePort>(CACHE_PORT)
  const queue = () => get<Queue>(getQueueToken(ORDER_EXPIRATION_QUEUE))

  /** Busca un producto del seed por slug. */
  async function product(slug: string): Promise<SeedProductRef> {
    const row = await prisma().product.findUniqueOrThrow({
      where: { slug },
      select: { id: true, slug: true, name: true, priceArs: true },
    })
    if (row.priceArs === null) throw new Error(`${slug} no tiene precio en el seed`)
    return { id: row.id, slug: row.slug, name: row.name, priceArs: row.priceArs }
  }

  /** Stock reservado de un producto. */
  async function reservedOf(productId: string): Promise<number> {
    const row = await prisma().inventory.findUniqueOrThrow({ where: { productId } })
    return row.reserved
  }

  /**
   * Borrador de pedido de productos sueltos (sin kits), listo para `orders.create`, como lo arma
   * `CreateOrderCommand` pero sin cotizar.
   */
  function draftOf(
    lines: [SeedProductRef, number][],
    options: { createdAt?: Date; customerId?: string | null } = {},
  ): OrderDraft {
    const createdAt = options.createdAt ?? new Date()
    const gross = lines.reduce((sum, [item, quantity]) => sum + item.priceArs * quantity, 0)
    return {
      id: newId(),
      number: null,
      customerId: options.customerId ?? null,
      contact: { email: 'manual@example.com', firstName: 'Ana', lastName: 'Gómez', phone: null },
      shipping: { method: 'pickup', address: null, costArs: 0, eta: 'Coordinás el retiro' },
      lines: lines.map(([item, quantity]) => ({
        type: 'product',
        name: item.name,
        detail: '',
        quantity,
        unitPriceArs: item.priceArs,
        kitSavingsArs: 0,
        totalArs: item.priceArs * quantity,
        productId: item.id,
        productSlug: item.slug,
        options: item.slug.startsWith('mate-') ? MATE_OPTIONS : null,
        kitItems: null,
      })),
      reservation: lines.map(([item, quantity]) => ({ productId: item.id, quantity })),
      itemsGrossArs: gross,
      kitSavingsArs: 0,
      subtotalArs: gross,
      totalArs: gross,
      kitDiscountPercent: 10,
      paymentMethod: 'mp_redirect',
      accessTokenHash: createHash('sha256').update(newId()).digest('hex'),
      createdAt,
      reservedUntil: reservedUntilFor(createdAt),
    }
  }

  /** Crea un pedido con el repositorio y exige que haya alcanzado el stock. */
  async function place(draft: OrderDraft): Promise<Order> {
    const result = await orders().create(draft, createdEvents)
    if (!result.ok) throw new Error(`No alcanzó el stock: ${JSON.stringify(result.error)}`)
    return result.value
  }

  describe('creación con CreateOrderCommand', () => {
    it('crea un pedido con un mate ×2 y un kit: seis tablas, reservas, número, evento y caché', async () => {
      const mate = await product('mate-imperial-premium')
      const bombilla = await product('bombillon-100-alpaca')
      const yerba = await product('yerba-canarias-1-kg')
      const items: CartItem[] = [
        { type: 'product', productId: mate.id, quantity: 2, options: MATE_OPTIONS },
        {
          type: 'kit',
          mateId: mate.id,
          bombillaId: bombilla.id,
          yerbaId: yerba.id,
          leather: 'Negro',
          quantity: 1,
        },
      ]
      const keys = [
        productSlugCacheKey(mate.slug),
        productSlugCacheKey(bombilla.slug),
        productSlugCacheKey(yerba.slug),
        productGroupCacheKey('mate'),
        productGroupCacheKey('bombilla'),
        productGroupCacheKey('yerba'),
      ]
      for (const key of keys) await cache().set(key, { viejo: true }, 60)
      expect(await cache().get(keys[0] ?? '')).toEqual({ viejo: true })
      const before = {
        mate: await reservedOf(mate.id),
        bombilla: await reservedOf(bombilla.id),
        yerba: await reservedOf(yerba.id),
      }

      const quote = await get(QuoteCartQuery).execute(items)
      const result = await get(CreateOrderCommand).execute(
        {
          customer: {
            email: 'Invitada@Example.com',
            firstName: 'Ana',
            lastName: 'Gómez',
            phone: null,
          },
          shipping: { method: 'pickup', address: null },
          items,
          paymentMethod: 'mp_redirect',
          expectedTotalArs: quote.subtotalArs,
          website: null,
        },
        { customerId: null },
      )

      expect(result.order.number).toBe('GLP-10001')
      expect(result.order.status).toBe('pending_payment')
      expect(result.order.totalArs).toBe(quote.subtotalArs)
      expect(await reservedOf(mate.id)).toBe(before.mate + 3)
      expect(await reservedOf(bombilla.id)).toBe(before.bombilla + 1)
      expect(await reservedOf(yerba.id)).toBe(before.yerba + 1)
      for (const key of keys) expect(await cache().get(key)).toBeNull()

      const row = await prisma().order.findUniqueOrThrow({
        where: { number: 'GLP-10001' },
        include: {
          items: { orderBy: { position: 'asc' }, include: { components: true } },
          history: true,
          reservations: true,
        },
      })
      const guest = await directory().findByEmail('invitada@example.com')
      expect(guest).toEqual({ id: row.customerId, userId: null })
      expect(row).toMatchObject({
        status: 'pending_payment',
        paymentStatus: 'none',
        paymentMethod: 'mp_redirect',
        contactEmail: 'invitada@example.com',
        shippingMethod: 'pickup',
        shippingAddress: null,
        kitDiscountPercent: 10,
      })
      expect(row.reservedUntil.getTime() - row.createdAt.getTime()).toBe(30 * MINUTE)
      expect(row.items.map((item) => [item.lineType, item.quantity, item.productSlug])).toEqual([
        ['product', 2, mate.slug],
        ['kit', 1, null],
      ])
      expect(row.items[0]?.options).toEqual(MATE_OPTIONS)
      expect(row.items[1]?.options).toEqual({ leather: 'Negro', ferrule: 'Alpaca cincelada' })
      expect(row.items[1]?.components.map((piece) => piece.role).sort()).toEqual([
        'bombilla',
        'mate',
        'yerba',
      ])
      expect(row.history).toEqual([
        expect.objectContaining({
          fromStatus: null,
          toStatus: 'pending_payment',
          actor: 'customer',
          createdAt: row.createdAt,
        }),
      ])
      expect(
        row.reservations
          .map((reservation) => [reservation.productId, reservation.quantity, reservation.status])
          .sort(),
      ).toEqual(
        [
          [mate.id, 3, 'active'],
          [bombilla.id, 1, 'active'],
          [yerba.id, 1, 'active'],
        ].sort(),
      )
      for (const reservation of row.reservations) {
        expect(reservation.expiresAt).toEqual(row.reservedUntil)
      }
      const events = await prisma().outboxEvent.findMany({
        where: { type: 'order.created', aggregateId: 'GLP-10001' },
      })
      expect(events).toHaveLength(1)
      expect(events[0]).toMatchObject({
        aggregateType: 'order',
        payload: {
          orderId: row.id,
          number: 'GLP-10001',
          customerId: row.customerId,
          totalArs: row.totalArs,
          reservedUntil: row.reservedUntil.toISOString(),
        },
      })

      // El repositorio lee lo que guardó: líneas, piezas del kit en orden y el historial.
      const saved = await orders().findByNumber('GLP-10001')
      expect(saved?.lines[1]?.kitItems?.map((piece) => piece.role)).toEqual([
        'mate',
        'bombilla',
        'yerba',
      ])
      expect(saved?.lines[0]).toMatchObject({ productId: mate.id, options: MATE_OPTIONS })
      expect(saved?.history).toEqual([{ status: 'pending_payment', at: row.createdAt, note: null }])

      // El token que devolvió abre el pedido.
      const view = await get(GetOrderQuery).execute('GLP-10001', {
        token: result.orderToken,
        customerId: null,
      })
      expect(view.number).toBe('GLP-10001')

      // El vencimiento quedó programado en la cola: jobId = id del pedido, a 30 minutos.
      const job = await queue().getJob(row.id)
      expect(await job?.getState()).toBe('delayed')
      expect(job?.delay).toBeGreaterThan(29 * MINUTE)
      expect(job?.delay).toBeLessThanOrEqual(30 * MINUTE)
      expect((await queue().getDelayed()).map((delayed) => delayed.id)).toContain(row.id)
    })

    it('el segundo pedido es GLP-10002 y reutiliza al invitado con el mismo email', async () => {
      const yerba = await product('yerba-canarias-1-kg')
      const items: CartItem[] = [
        { type: 'product', productId: yerba.id, quantity: 1, options: null },
      ]
      const quote = await get(QuoteCartQuery).execute(items)
      const result = await get(CreateOrderCommand).execute(
        {
          customer: {
            email: 'invitada@example.com',
            firstName: 'Anita',
            lastName: 'Gómez',
            phone: '1155556666',
          },
          shipping: { method: 'pickup', address: null },
          items,
          paymentMethod: 'card',
          expectedTotalArs: quote.subtotalArs,
          website: null,
        },
        { customerId: null },
      )

      expect(result.order.number).toBe('GLP-10002')
      const [first, second] = await prisma().order.findMany({
        where: { number: { in: ['GLP-10001', 'GLP-10002'] } },
        orderBy: { number: 'asc' },
      })
      expect(second?.customerId).toBe(first?.customerId)
      const guest = await prisma().customer.findUniqueOrThrow({
        where: { email: 'invitada@example.com' },
      })
      expect(guest).toMatchObject({ firstName: 'Anita', phone: '1155556666', userId: null })
    })

    it('con el email de una cuenta, el pedido queda sin dueño (solo por token)', async () => {
      const userId = newId()
      await get<CustomerRepository>(CUSTOMER_REPOSITORY).createWithUser(
        {
          id: userId,
          email: 'cuenta@example.com',
          passwordHash: 'hash',
          role: 'customer',
          status: 'active',
        },
        {
          id: newId(),
          email: 'cuenta@example.com',
          firstName: 'Carla',
          lastName: 'Paz',
          phone: null,
        },
      )
      const yerba = await product('yerba-canarias-1-kg')
      const items: CartItem[] = [
        { type: 'product', productId: yerba.id, quantity: 1, options: null },
      ]
      const quote = await get(QuoteCartQuery).execute(items)
      const result = await get(CreateOrderCommand).execute(
        {
          customer: { email: 'cuenta@example.com', firstName: 'X', lastName: 'Y', phone: null },
          shipping: { method: 'pickup', address: null },
          items,
          paymentMethod: 'mp_redirect',
          expectedTotalArs: quote.subtotalArs,
          website: null,
        },
        { customerId: null },
      )

      const row = await prisma().order.findUniqueOrThrow({
        where: { number: result.order.number },
      })
      expect(row.customerId).toBeNull()
      expect(await directory().findByEmail('cuenta@example.com')).toMatchObject({ userId })
    })
  })

  describe('catálogo para cotizar', () => {
    it('trae publicados y no publicados con el stock libre, y descarta los ids que no son UUID', async () => {
      const coquito = await product('mate-coquito-criollo')
      await prisma().product.update({ where: { id: coquito.id }, data: { status: 'draft' } })
      try {
        const found = await get<ProductCatalogPort>(PRODUCT_CATALOG_PORT).findForCart([
          coquito.id,
          'prd-001',
          newId(),
        ])
        expect(found).toEqual([
          {
            id: coquito.id,
            slug: coquito.slug,
            name: coquito.name,
            group: 'mate',
            priceArs: coquito.priceArs,
            published: false,
            available: 2,
          },
        ])
      } finally {
        await prisma().product.update({ where: { id: coquito.id }, data: { status: 'published' } })
      }
    })
  })

  describe('reserva atómica', () => {
    it('10 pedidos simultáneos de 1 unidad con 5 en stock: 5 entran y 5 reciben available 0', async () => {
      const coquito = await product('mate-coquito-criollo')
      await prisma().inventory.update({
        where: { productId: coquito.id },
        data: { onHand: 5, reserved: 0 },
      })

      const results = await Promise.all(
        Array.from({ length: 10 }, () => orders().create(draftOf([[coquito, 1]]), createdEvents)),
      )

      const placed = results.filter((result) => result.ok)
      const rejected = results.filter((result) => !result.ok)
      expect(placed).toHaveLength(5)
      expect(rejected).toHaveLength(5)
      for (const result of rejected) {
        expect(result.error).toEqual([{ productId: coquito.id, available: 0 }])
      }
      expect(await reservedOf(coquito.id)).toBe(5)
      expect(
        await prisma().stockReservation.count({
          where: { productId: coquito.id, status: 'active' },
        }),
      ).toBe(5)
      expect(
        await prisma().order.count({
          where: { items: { some: { productId: coquito.id } }, status: 'pending_payment' },
        }),
      ).toBe(5)
    })

    it('devuelve todos los productos que no alcanzan y no guarda nada', async () => {
      const coquito = await product('mate-coquito-criollo')
      const curvo = await product('bombillon-curvo-de-alpaca')
      const yerba = await product('yerba-canarias-serena-1-kg')
      await prisma().inventory.update({
        where: { productId: curvo.id },
        data: { onHand: 3, reserved: 1 },
      })
      const ordersBefore = await prisma().order.count()
      const yerbaBefore = await reservedOf(yerba.id)

      const result = await orders().create(
        draftOf([
          [yerba, 1],
          [coquito, 1],
          [curvo, 5],
        ]),
        createdEvents,
      )

      expect(result.ok).toBe(false)
      if (result.ok) return
      expect([...result.error].sort((a, b) => a.productId.localeCompare(b.productId))).toEqual(
        [
          { productId: coquito.id, available: 0 },
          { productId: curvo.id, available: 2 },
        ].sort((a, b) => a.productId.localeCompare(b.productId)),
      )
      expect(await prisma().order.count()).toBe(ordersBefore)
      expect(await reservedOf(yerba.id)).toBe(yerbaBefore)
      expect(await reservedOf(curvo.id)).toBe(1)
    })
  })

  describe('vencimiento', () => {
    it('tres expire a la vez liberan una sola vez, con el historial en reserved_until', async () => {
      const yerba = await product('yerba-canarias-te-y-jengibre-1-kg')
      const before = await reservedOf(yerba.id)
      const order = await place(
        draftOf([[yerba, 2]], { createdAt: new Date(Date.now() - 31 * MINUTE) }),
      )
      expect(await reservedOf(yerba.id)).toBe(before + 2)
      await cache().set(productSlugCacheKey(yerba.slug), { viejo: true }, 60)

      const now = new Date()
      const results = await Promise.all(
        [1, 2, 3].map(() => orders().expire(order.id, now, expiredEvents)),
      )

      const expired = results.filter((result) => result !== null)
      expect(expired).toHaveLength(1)
      expect(expired[0]?.status).toBe('expired')
      expect(expired[0]?.history).toEqual([
        { status: 'pending_payment', at: order.createdAt, note: null },
        { status: 'expired', at: order.reservedUntil, note: null },
      ])
      expect(await reservedOf(yerba.id)).toBe(before)
      expect(await cache().get(productSlugCacheKey(yerba.slug))).toBeNull()
      const history = await prisma().orderStatusHistory.findMany({
        where: { orderId: order.id, toStatus: 'expired' },
      })
      expect(history).toEqual([
        expect.objectContaining({
          fromStatus: 'pending_payment',
          actor: 'system',
          createdAt: order.reservedUntil,
        }),
      ])
      expect(
        await prisma().stockReservation.findMany({
          where: { orderId: order.id },
          select: { status: true },
        }),
      ).toEqual([{ status: 'released' }])
      expect(
        await prisma().outboxEvent.count({
          where: { type: 'order.expired', aggregateId: order.number },
        }),
      ).toBe(1)
      expect(await orders().expire(order.id, new Date(), expiredEvents)).toBeNull()
    })

    it('no vence un pedido que todavía no llegó a reserved_until', async () => {
      const yerba = await product('yerba-canarias-te-y-jengibre-1-kg')
      const order = await place(draftOf([[yerba, 1]]))

      expect(await orders().expire(order.id, new Date(), expiredEvents)).toBeNull()
      expect((await orders().findByNumber(order.number))?.status).toBe('pending_payment')
    })

    it('findDue respeta el límite, ordena por reserved_until y no trae pagos pending', async () => {
      const bombilla = await product('bombillon-curvo')
      const oldest = await place(
        draftOf([[bombilla, 1]], { createdAt: new Date(Date.now() - 40 * MINUTE) }),
      )
      const middle = await place(
        draftOf([[bombilla, 1]], { createdAt: new Date(Date.now() - 35 * MINUTE) }),
      )
      const paying = await place(
        draftOf([[bombilla, 1]], { createdAt: new Date(Date.now() - 45 * MINUTE) }),
      )
      await prisma().order.update({ where: { id: paying.id }, data: { paymentStatus: 'pending' } })

      const now = new Date()
      const first = await orders().findDue(now, 1)
      const all = await orders().findDue(now, 50)

      expect(first.map((order) => order.number)).toEqual([oldest.number])
      const numbers = all.map((order) => order.number)
      expect(numbers).not.toContain(paying.number)
      expect(numbers.indexOf(oldest.number)).toBeLessThan(numbers.indexOf(middle.number))

      // El barrido los vence (salvo el que tiene un pago en curso).
      expect(await get(OrderExpirationSweep).runOnce()).toBeGreaterThanOrEqual(2)
      expect((await orders().findByNumber(oldest.number))?.status).toBe('expired')
      expect((await orders().findByNumber(middle.number))?.status).toBe('expired')
      expect((await orders().findByNumber(paying.number))?.status).toBe('pending_payment')
    })

    it('el processor de la cola vence un pedido con reserved_until en el pasado', async () => {
      const bombilla = await product('bombillon-alpaca-18-cm')
      const before = await reservedOf(bombilla.id)
      const order = await place(
        draftOf([[bombilla, 1]], { createdAt: new Date(Date.now() - 31 * MINUTE) }),
      )

      await queue().add(ORDER_EXPIRE_JOB, { orderId: order.id }, { jobId: order.id, delay: 0 })

      await vi.waitFor(
        async () => {
          expect((await orders().findByNumber(order.number))?.status).toBe('expired')
        },
        { timeout: 15_000, interval: 200 },
      )
      expect(await reservedOf(bombilla.id)).toBe(before)
    })
  })

  describe('listado por cliente', () => {
    it('ordena por createdAt desc (y number desc a igual fecha) y pagina', async () => {
      const { id: customerId } = await directory().createGuest({
        email: 'listado@example.com',
        firstName: 'Lía',
        lastName: 'Ruiz',
        phone: null,
      })
      const yerba = await product('yerba-canarias-1-kg')
      const base = Date.now() - 5 * MINUTE
      const a = await place(draftOf([[yerba, 1]], { customerId, createdAt: new Date(base) }))
      const b = await place(
        draftOf([[yerba, 1]], { customerId, createdAt: new Date(base + MINUTE) }),
      )
      const c = await place(
        draftOf([[yerba, 1]], { customerId, createdAt: new Date(base + MINUTE) }),
      )

      const first = await orders().listByCustomer(customerId, 1, 2)
      const second = await orders().listByCustomer(customerId, 2, 2)
      const beyond = await orders().listByCustomer(customerId, 3, 2)

      expect(first.total).toBe(3)
      expect(first.items.map((order) => order.number)).toEqual([c.number, b.number])
      expect(second.items.map((order) => order.number)).toEqual([a.number])
      expect(beyond).toEqual({ items: [], total: 3 })
      expect(first.items[0]?.lines).toHaveLength(1)
    })
  })

  describe('clientes (IdentityCustomersAdapter)', () => {
    it('crea un invitado, lo reutiliza si se crea a la vez y actualiza sus datos', async () => {
      const contact = {
        email: 'carrera@example.com',
        firstName: 'Rita',
        lastName: 'Sosa',
        phone: null,
      }

      const created = await Promise.all([1, 2, 3].map(() => directory().createGuest(contact)))
      const again = await directory().createGuest(contact)

      const ids = new Set([...created, again].map((guest) => guest.id))
      expect(ids.size).toBe(1)
      const [id] = [...ids]
      expect(await directory().findByEmail('carrera@example.com')).toEqual({ id, userId: null })

      await directory().updateGuest(id ?? '', {
        firstName: 'Rita María',
        lastName: 'Sosa',
        phone: '1144443333',
      })
      expect(
        await prisma().customer.findUniqueOrThrow({ where: { email: 'carrera@example.com' } }),
      ).toMatchObject({ firstName: 'Rita María', phone: '1144443333' })
      expect(await directory().findByEmail('nadie@example.com')).toBeNull()
    })
  })
})
