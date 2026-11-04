import type { INestApplication } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import type { Server } from 'node:http'
import type request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { comboSeedId, seed } from '../../prisma/seed'
import type {
  CreateOrderResultView,
  OrderSummaryPageView,
  OrderView,
} from '../../src/modules/orders/application/read-models'
import { OrderExpirationSweep } from '../../src/modules/orders/infrastructure/order-expiration.sweep'
import { SETTINGS_CACHE_KEY } from '../../src/modules/settings/infrastructure/cached-settings.repository'
import { CACHE_PORT, type CachePort } from '../../src/shared/application/ports/cache.port'
import { PrismaService } from '../../src/shared/infrastructure/prisma/prisma.service'
import { createApp } from '../support/app'
import { startContainers, type TestContainers } from '../support/containers'
import {
  call,
  type CallOptions,
  firstError,
  type HttpMethod,
  type Jar,
  newJar,
  refreshCsrf,
} from '../support/http'
import { comboLine, HOME_ADDRESS, MATE_OPTIONS, mateLine, ordersHttp } from '../support/orders-http'

/** Producto del seed, con lo que usan los casos. */
interface SeedProduct {
  id: string
  name: string
  priceArs: number
}

/** Contraseña válida para las cuentas que se registran. */
const PASSWORD = 'galpon2026ok'

/** Treinta minutos, en milisegundos. */
const RESERVATION_MS = 30 * 60_000

describe('pedidos por HTTP (Postgres + Redis + BullMQ)', () => {
  let containers: TestContainers | undefined
  let app: INestApplication<Server> | undefined
  const previousEnv = { DATABASE_URL: process.env.DATABASE_URL, REDIS_URL: process.env.REDIS_URL }
  let mate: SeedProduct
  let coquito: SeedProduct
  let galleta: SeedProduct
  let bombilla: SeedProduct
  let yerba: SeedProduct

  beforeAll(async () => {
    containers = await startContainers()
    process.env.DATABASE_URL = containers.databaseUrl
    process.env.REDIS_URL = containers.redisUrl
    app = await createApp()
    // Escucha una vez: así los 10 pedidos simultáneos de supertest no abren 10 servidores.
    await app.listen(0, '127.0.0.1')
    await seed(app.get(PrismaService))
    mate = await product('mate-imperial-premium')
    coquito = await product('mate-coquito-criollo')
    galleta = await product('mate-galleta')
    bombilla = await product('bombillon-100-alpaca')
    yerba = await product('yerba-canarias-1-kg')
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

  const prisma = (): PrismaService => {
    if (app === undefined) throw new Error('La app no arrancó')
    return app.get(PrismaService)
  }

  function send(
    jar: Jar,
    method: HttpMethod,
    path: string,
    options?: CallOptions,
  ): Promise<request.Response> {
    return call(server(), jar, method, path, options)
  }

  async function product(slug: string): Promise<SeedProduct> {
    const row = await prisma().product.findUniqueOrThrow({
      where: { slug },
      select: { id: true, name: true, priceArs: true },
    })
    if (row.priceArs === null) throw new Error(`${slug} no tiene precio en el seed`)
    return { id: row.id, name: row.name, priceArs: row.priceArs }
  }

  async function reservedOf(productId: string): Promise<number> {
    const row = await prisma().inventory.findUniqueOrThrow({ where: { productId } })
    return row.reserved
  }

  /** `maxQuantity` del producto en `GET /products?ids=` (lo que concilia la tienda). */
  async function maxQuantityOf(productId: string): Promise<number> {
    const response = await send(newJar(), 'get', `/products?ids=${productId}`)
    expect(response.status).toBe(200)
    const [item] = (response.body as { items: { maxQuantity: number }[] }).items
    if (item === undefined) throw new Error('El producto no salió en el catálogo')
    return item.maxQuantity
  }

  const { quote, orderBody, placeOrder, createdOrder } = ordersHttp(server)

  /** Cliente registrado, con su sesión en el jar (y un CSRF que queda viejo). */
  async function registered(email: string): Promise<Jar> {
    const jar = newJar()
    await refreshCsrf(server(), jar)
    const response = await send(jar, 'post', '/auth/register', {
      body: { email, firstName: 'Ana', lastName: 'Pérez', password: PASSWORD },
    })
    expect(response.status).toBe(201)
    return jar
  }

  describe('cotizaciones', () => {
    it('POST /cart/quote del mate imperial: clave, neto y tope exactos; ignora un CSRF viejo', async () => {
      const response = await send(newJar(), 'post', '/cart/quote', {
        body: { items: [mateLine(mate.id), mateLine(galleta.id)] },
        headers: { 'X-CSRF-Token': 'token-viejo' },
      })

      expect(response.status).toBe(200)
      expect(response.body).toEqual({
        lines: [
          {
            key: `product:${mate.id}:Negro:Alpaca cincelada`,
            type: 'product',
            name: 'Mate Imperial Premium',
            detail: 'Cuero negro · Alpaca cincelada',
            unitPriceArs: 39999,
            netUnitPriceArs: 33057,
            kitSavingsArs: 0,
            totalArs: 39999,
            maxQuantity: 12,
            issue: null,
          },
          {
            key: `product:${galleta.id}:Negro:Alpaca cincelada`,
            type: 'product',
            name: galleta.name,
            detail: 'Cuero negro · Alpaca cincelada',
            unitPriceArs: 0,
            netUnitPriceArs: 0,
            kitSavingsArs: 0,
            totalArs: 0,
            maxQuantity: 0,
            issue: 'sold_out',
          },
        ],
        itemsGrossArs: 39999,
        kitSavingsArs: 0,
        subtotalArs: 39999,
        netSubtotalArs: 33057,
      })
    })

    it('POST /cart/quote de un kit ×2 con 10 %: las cuentas del kit', async () => {
      const kit = {
        type: 'kit',
        mateId: mate.id,
        bombillaId: bombilla.id,
        yerbaId: yerba.id,
        leather: 'Negro',
        quantity: 2,
      }

      const result = await quote([kit])

      expect(result.lines[0]).toMatchObject({
        key: `kit:${mate.id}:${bombilla.id}:${yerba.id}:Negro`,
        name: 'Kit',
        unitPriceArs: 75997,
        kitSavingsArs: 15200,
        totalArs: 136794,
        netUnitPriceArs: 56526,
        issue: null,
      })
    })

    it('POST /shipping/quote: costo y plazo del seed; sin código postal fuera del retiro → 422', async () => {
      const home = await send(newJar(), 'post', '/shipping/quote', {
        body: { method: 'home', postalCode: 'c1043', items: [mateLine(mate.id)] },
      })
      const pickup = await send(newJar(), 'post', '/shipping/quote', {
        body: { method: 'pickup', postalCode: null, items: [mateLine(mate.id)] },
      })
      const missing = await send(newJar(), 'post', '/shipping/quote', {
        body: { method: 'home', postalCode: null, items: [mateLine(mate.id)] },
      })

      expect(home.status).toBe(200)
      expect(home.body).toEqual({ method: 'home', costArs: 6500, eta: '3 a 6 días hábiles' })
      expect(pickup.body).toMatchObject({ method: 'pickup', costArs: 0 })
      expect(missing.status).toBe(422)
      expect(firstError(missing)).toEqual({
        field: 'postalCode',
        code: 'required',
        message: 'Ingresá el código postal.',
      })
    })
  })

  describe('creación', () => {
    it('201 con el pedido del contrato: nulls explícitos, historial y reserva de 30 minutos', async () => {
      const reservedBefore = await reservedOf(mate.id)
      const body = await orderBody([mateLine(mate.id)], 'invitada@ejemplo.com')

      const response = await placeOrder(newJar(), {
        ...body,
        customer: {
          email: ' Invitada@Ejemplo.com ',
          firstName: 'Lucía',
          lastName: 'Pérez',
          phone: '',
        },
      })

      expect(response.status).toBe(201)
      const { order, orderToken } = response.body as CreateOrderResultView
      expect(orderToken).toMatch(/^ot_[0-9a-f]{64}$/)
      expect(order.number).toMatch(/^GLP-\d{5}$/)
      expect(order).toMatchObject({
        status: 'pending_payment',
        paymentStatus: 'none',
        customer: {
          email: 'invitada@ejemplo.com',
          firstName: 'Lucía',
          lastName: 'Pérez',
          phone: null,
        },
        shipping: {
          method: 'home',
          address: HOME_ADDRESS,
          costArs: 6500,
          eta: '3 a 6 días hábiles',
        },
        itemsGrossArs: 39999,
        kitSavingsArs: 0,
        subtotalArs: 39999,
        shippingArs: 6500,
        totalArs: 46499,
        payment: {
          method: 'mp_redirect',
          installments: null,
          paymentTypeId: null,
          lastFour: null,
          statusDetail: null,
          mpPaymentId: null,
          challenge: null,
        },
        tracking: null,
        history: [{ status: 'pending_payment', at: order.createdAt, note: null }],
      })
      expect(order.lines).toEqual([
        {
          type: 'product',
          name: 'Mate Imperial Premium',
          detail: 'Cuero negro · Alpaca cincelada',
          quantity: 1,
          unitPriceArs: 39999,
          kitSavingsArs: 0,
          totalArs: 39999,
          productSlug: 'mate-imperial-premium',
          options: MATE_OPTIONS,
          kitItems: null,
        },
      ])
      expect(Date.parse(order.reservedUntil) - Date.parse(order.createdAt)).toBe(RESERVATION_MS)
      expect(await reservedOf(mate.id)).toBe(reservedBefore + 1)
    })

    it('doble envío: misma clave y mismo cuerpo a la vez → un solo pedido, mismo número y token', async () => {
      const body = await orderBody([mateLine(mate.id)], 'doble@ejemplo.com')
      const key = randomUUID()

      const responses = await Promise.all([
        placeOrder(newJar(), body, key),
        placeOrder(newJar(), body, key),
      ])
      const retry = await placeOrder(newJar(), body, key)

      const created = responses.filter((response) => response.status === 201)
      const others = responses.filter((response) => response.status !== 201)
      expect(created.length).toBeGreaterThanOrEqual(1)
      // B1 (Ruling B-22): si el segundo llega mientras el primero corre, 409 en curso.
      for (const response of others) {
        expect(response.status).toBe(409)
        expect(response.body).toMatchObject({ type: 'idempotency_in_progress' })
      }
      const [first] = created
      const result = first?.body as CreateOrderResultView
      for (const response of [...created, retry]) {
        const { order, orderToken } = response.body as CreateOrderResultView
        expect(order.number).toBe(result.order.number)
        expect(orderToken).toBe(result.orderToken)
      }
      expect(retry.status).toBe(201)
      expect(retry.headers['idempotent-replayed']).toBe('true')
      expect(await prisma().order.count({ where: { contactEmail: 'doble@ejemplo.com' } })).toBe(1)
    })

    it('la misma clave con otro cuerpo → 422 idempotency_key_reused', async () => {
      const body = await orderBody([mateLine(mate.id)], 'clave@ejemplo.com')
      const key = randomUUID()
      expect((await placeOrder(newJar(), body, key)).status).toBe(201)

      const reused = await placeOrder(newJar(), { ...body, paymentMethod: 'card' }, key)

      expect(reused.status).toBe(422)
      expect(reused.body).toMatchObject({
        type: 'idempotency_key_reused',
        detail: 'La Idempotency-Key ya se usó con otros datos. Generá una nueva para este intento.',
      })
    })

    it('409 total_changed no crea nada, libera la clave y una clave nueva crea el pedido', async () => {
      const body = await orderBody([mateLine(mate.id)], 'total@ejemplo.com')
      const key = randomUUID()

      const conflict = await placeOrder(newJar(), { ...body, expectedTotalArs: 40000 }, key)
      const fresh = await placeOrder(newJar(), body)

      expect(conflict.status).toBe(409)
      expect(conflict.body).toEqual({
        type: 'total_changed',
        title: 'El total cambió',
        status: 409,
        detail: 'El pedido cambió desde que armaste el resumen. Revisalo antes de pagar.',
        instance: '/api/v1/orders',
        changes: [
          { kind: 'price', productId: null, message: 'El total cambió de $40.000 a $46.499.' },
        ],
      })
      expect(await prisma().idempotencyKey.count({ where: { key } })).toBe(0)
      expect(fresh.status).toBe(201)
      expect(await prisma().order.count({ where: { contactEmail: 'total@ejemplo.com' } })).toBe(1)
    })

    it('409 price_changed con el precio viejo y total_changed sin él; nada reservado', async () => {
      const line = { ...mateLine(mate.id), expectedUnitPriceArs: mate.priceArs }
      const body = await orderBody([line], 'precio@ejemplo.com')
      const reservedBefore = await reservedOf(mate.id)
      await prisma().product.update({ where: { id: mate.id }, data: { priceArs: 41999 } })

      try {
        const priceChanged = await placeOrder(newJar(), body)
        const totalChanged = await placeOrder(newJar(), { ...body, items: [mateLine(mate.id)] })

        expect(priceChanged.status).toBe(409)
        expect(priceChanged.body).toMatchObject({
          type: 'price_changed',
          title: 'Cambiaron los precios',
          changes: [
            {
              kind: 'price',
              productId: mate.id,
              message: 'Mate Imperial Premium cambió de precio: ahora cuesta $41.999.',
            },
          ],
        })
        expect(totalChanged.status).toBe(409)
        expect(totalChanged.body).toMatchObject({
          type: 'total_changed',
          changes: [
            { kind: 'price', productId: null, message: 'El total cambió de $46.499 a $48.499.' },
          ],
        })
        expect(await reservedOf(mate.id)).toBe(reservedBefore)
      } finally {
        await prisma().product.update({ where: { id: mate.id }, data: { priceArs: mate.priceArs } })
      }
    })

    it('un método de envío deshabilitado → 422 en shipping.method con el detail del contrato', async () => {
      const body = await orderBody([mateLine(mate.id)], 'sucursal@ejemplo.com')
      const cache = app?.get<CachePort>(CACHE_PORT)
      await prisma().shippingOption.update({
        where: { method: 'branch' },
        data: { enabled: false },
      })
      await cache?.del(SETTINGS_CACHE_KEY)

      try {
        const response = await placeOrder(newJar(), {
          ...body,
          shipping: {
            method: 'branch',
            address: { postalCode: '8300', city: 'Neuquén', province: 'Neuquén' },
          },
        })

        expect(response.status).toBe(422)
        expect(response.body).toMatchObject({
          type: 'validation_error',
          detail: 'Ese método de envío ya no está disponible. Volvé al paso de envío y elegí otro.',
          errors: [
            {
              field: 'shipping.method',
              code: 'unavailable',
              message: 'Ese método de envío no está disponible.',
            },
          ],
        })
      } finally {
        await prisma().shippingOption.update({
          where: { method: 'branch' },
          data: { enabled: true },
        })
        await cache?.del(SETTINGS_CACHE_KEY)
      }
    })

    it('honeypot con texto → 201 GLP-00000 sin guardar ni reservar nada', async () => {
      const body = await orderBody([mateLine(mate.id)], 'bot@ejemplo.com')
      const reservedBefore = await reservedOf(mate.id)
      const ordersBefore = await prisma().order.count()

      const response = await placeOrder(newJar(), { ...body, website: 'spam' })

      expect(response.status).toBe(201)
      const { order, orderToken } = response.body as CreateOrderResultView
      expect(order.number).toBe('GLP-00000')
      expect(orderToken).toMatch(/^ot_[0-9a-f]{64}$/)
      expect(await prisma().order.count()).toBe(ordersBefore)
      expect(await reservedOf(mate.id)).toBe(reservedBefore)
    })

    it('sin sobreventa: 10 pedidos a la vez sobre 5 unidades → 5 creados y 5 409 "se agotó"', async () => {
      await prisma().inventory.update({
        where: { productId: coquito.id },
        data: { onHand: 5, reserved: 0 },
      })
      const body = await orderBody([mateLine(coquito.id)], 'carrera@ejemplo.com')

      const responses = await Promise.all(
        Array.from({ length: 10 }, () => placeOrder(newJar(), body)),
      )

      const statuses = responses.map((response) => response.status).sort()
      expect(statuses).toEqual([201, 201, 201, 201, 201, 409, 409, 409, 409, 409])
      for (const response of responses.filter((candidate) => candidate.status === 409)) {
        expect(response.body).toMatchObject({
          type: 'stock_changed',
          changes: [{ kind: 'stock', productId: coquito.id, message: `${coquito.name} se agotó.` }],
        })
      }
      expect(await reservedOf(coquito.id)).toBe(5)
      expect(
        await prisma().stockReservation.count({
          where: { productId: coquito.id, status: 'active' },
        }),
      ).toBe(5)
      expect(
        await prisma().order.count({
          where: { contactEmail: 'carrera@ejemplo.com', status: 'pending_payment' },
        }),
      ).toBe(5)
    })
  })

  describe('lectura y vencimiento', () => {
    it('GET /orders/{number}: por token 200; sin token, con otro token o inexistente → 404 igual', async () => {
      const { order, orderToken } = await createdOrder(
        newJar(),
        await orderBody([mateLine(mate.id)], 'lectura@ejemplo.com'),
      )

      const byToken = await send(newJar(), 'get', `/orders/${order.number}`, {
        headers: { 'X-Order-Token': orderToken },
      })
      const noToken = await send(newJar(), 'get', `/orders/${order.number}`)
      const otherToken = await send(newJar(), 'get', `/orders/${order.number}`, {
        headers: { 'X-Order-Token': `ot_${'0'.repeat(64)}` },
      })
      const missing = await send(newJar(), 'get', '/orders/GLP-99999', {
        headers: { 'X-Order-Token': orderToken },
      })
      const invalid = await send(newJar(), 'get', '/orders/GLP-123')

      expect(byToken.status).toBe(200)
      expect(byToken.body).toEqual(order)
      for (const response of [noToken, otherToken, missing]) {
        expect(response.status).toBe(404)
        expect(response.body).toMatchObject({
          type: 'not_found',
          title: 'No encontrado',
          detail: 'No encontramos ese pedido.',
        })
      }
      expect(invalid.status).toBe(422)
      expect(firstError(invalid)).toEqual({
        field: 'number',
        code: 'invalid_format',
        message: 'El número de pedido tiene que ser GLP- y cinco dígitos.',
      })
    })

    it('pasado reservedUntil, la lectura lo vence: expired, stock de vuelta y se libera una sola vez', async () => {
      const maxBefore = await maxQuantityOf(mate.id)
      const reservedBefore = await reservedOf(mate.id)
      const { order, orderToken } = await createdOrder(
        newJar(),
        await orderBody([mateLine(mate.id, 2)], 'vence@ejemplo.com'),
      )
      expect(await maxQuantityOf(mate.id)).toBe(maxBefore - 2)
      // Como si el pedido se hubiera creado hace 31 minutos (la cola sigue demorada en tiempo
      // real, así que no corre durante el test).
      const createdAt = new Date(Date.now() - RESERVATION_MS - 60_000)
      const reservedUntil = new Date(createdAt.getTime() + RESERVATION_MS)
      await prisma().order.update({
        where: { number: order.number },
        data: { createdAt, placedAt: createdAt, reservedUntil },
      })
      await prisma().orderStatusHistory.updateMany({
        where: { order: { number: order.number } },
        data: { createdAt },
      })
      const read = () =>
        send(newJar(), 'get', `/orders/${order.number}`, {
          headers: { 'X-Order-Token': orderToken },
        })

      const expired = await read()
      await app?.get(OrderExpirationSweep).runOnce()
      const again = await read()

      expect(expired.status).toBe(200)
      const view = expired.body as OrderView
      expect(view.status).toBe('expired')
      expect(view.reservedUntil).toBe(reservedUntil.toISOString())
      expect(view.history).toEqual([
        { status: 'pending_payment', at: createdAt.toISOString(), note: null },
        { status: 'expired', at: reservedUntil.toISOString(), note: null },
      ])
      expect(again.body).toEqual(view)
      expect(await reservedOf(mate.id)).toBe(reservedBefore)
      expect(await maxQuantityOf(mate.id)).toBe(maxBefore)
      expect(
        await prisma().stockReservation.findMany({
          where: { order: { number: order.number } },
          select: { status: true },
        }),
      ).toEqual([{ status: 'released' }])
      expect(
        await prisma().outboxEvent.count({
          where: { type: 'order.expired', aggregateId: order.number },
        }),
      ).toBe(1)
    })
  })

  describe('dueño del pedido y "mis pedidos"', () => {
    it('GET /me/orders de una cuenta nueva → lista vacía; ?pageSize → 422', async () => {
      const jar = await registered('vacia@ejemplo.com')

      const empty = await send(jar, 'get', '/me/orders')
      const pageSize = await send(jar, 'get', '/me/orders?pageSize=5')
      const anonymous = await send(newJar(), 'get', '/me/orders')

      expect(empty.status).toBe(200)
      expect(empty.body).toEqual({ items: [], page: 1, pageSize: 10, total: 0 })
      expect(pageSize.status).toBe(422)
      expect(firstError(pageSize)).toMatchObject({ field: 'pageSize', code: 'unrecognized_key' })
      expect(anonymous.status).toBe(401)
    })

    it('con sesión (y un CSRF viejo) el pedido queda en la cuenta: lista, detalle y lectura por sesión', async () => {
      const jar = await registered('cuenta@ejemplo.com')
      const body = await orderBody(
        [
          mateLine(mate.id),
          { type: 'product', productId: bombilla.id, quantity: 2, options: null },
        ],
        'otro-mail@ejemplo.com',
      )

      const { order } = await createdOrder(jar, body)
      const list = await send(jar, 'get', '/me/orders')
      const detail = await send(jar, 'get', `/me/orders/${order.number}`)
      const bySession = await send(jar, 'get', `/orders/${order.number}`)
      const secondPage = await send(jar, 'get', '/me/orders?page=2')

      expect(order.customer.email).toBe('otro-mail@ejemplo.com')
      expect(list.status).toBe(200)
      expect(list.body).toEqual({
        items: [
          {
            number: order.number,
            createdAt: order.createdAt,
            status: 'pending_payment',
            paymentStatus: 'none',
            totalArs: order.totalArs,
            itemCount: 3,
          },
        ],
        page: 1,
        pageSize: 10,
        total: 1,
      } satisfies OrderSummaryPageView)
      expect(detail.status).toBe(200)
      expect(detail.body).toEqual(order)
      expect(bySession.status).toBe(200)
      expect(secondPage.body).toEqual({ items: [], page: 2, pageSize: 10, total: 1 })
    })

    it('un invitado con el email de una cuenta no entra en esa cuenta: 404 por sesión, 200 por token', async () => {
      const jar = await registered('ajena@ejemplo.com')
      const { order, orderToken } = await createdOrder(
        newJar(),
        await orderBody([mateLine(mate.id)], 'ajena@ejemplo.com'),
      )

      const list = await send(jar, 'get', '/me/orders')
      const mine = await send(jar, 'get', `/me/orders/${order.number}`)
      const bySession = await send(jar, 'get', `/orders/${order.number}`)
      const byToken = await send(newJar(), 'get', `/orders/${order.number}`, {
        headers: { 'X-Order-Token': orderToken },
      })

      expect((list.body as OrderSummaryPageView).total).toBe(0)
      expect(mine.status).toBe(404)
      expect(bySession.status).toBe(404)
      expect(byToken.status).toBe(200)
    })

    it('un invitado que después se registra con ese email ve el pedido en su cuenta', async () => {
      const { order } = await createdOrder(
        newJar(),
        await orderBody([mateLine(mate.id)], 'despues@ejemplo.com'),
      )

      const jar = await registered('despues@ejemplo.com')
      const list = await send(jar, 'get', '/me/orders')
      const detail = await send(jar, 'get', `/me/orders/${order.number}`)

      expect((list.body as OrderSummaryPageView).items.map((item) => item.number)).toEqual([
        order.number,
      ])
      expect(detail.status).toBe(200)
    })
  })

  describe('combos', () => {
    /** "Dúo Imperial" del seed: Mate Imperial Premium ($39.999) + Bombillón Premium Curvo ($28.999). */
    const duoId = comboSeedId({ key: 'cmb-duo-imperial' })
    /** Opciones del ejemplo del mock. */
    const BROWN = { leather: 'Marrón', ferrule: 'Acero' }
    let curvo: SeedProduct

    /** Deja `available` unidades libres sin tocar lo reservado por los pedidos anteriores. */
    async function setAvailable(productId: string, available: number): Promise<void> {
      const { reserved } = await prisma().inventory.findUniqueOrThrow({ where: { productId } })
      await prisma().inventory.update({
        where: { productId },
        data: { onHand: reserved + available },
      })
    }

    beforeAll(async () => {
      curvo = await product('bombillon-premium-curvo')
    })

    beforeEach(async () => {
      await setAvailable(mate.id, 12)
      await setAvailable(curvo.id, 12)
    })

    it('POST /cart/quote de "Dúo Imperial" ×2: las cuentas del mock; un id que no es UUID no existe', async () => {
      const result = await quote([comboLine(duoId, 2, BROWN), comboLine('cmb-duo-imperial')])

      expect(result).toEqual({
        lines: [
          {
            key: `combo:${duoId}:Marrón:Acero`,
            type: 'combo',
            name: 'Dúo Imperial',
            detail: 'Mate Imperial Premium + Bombillón Premium Curvo · Cuero marrón · Acero',
            unitPriceArs: 68998,
            netUnitPriceArs: 51239,
            kitSavingsArs: 13998,
            totalArs: 123998,
            maxQuantity: 12,
            issue: null,
          },
          {
            key: 'combo:cmb-duo-imperial:Negro:Alpaca cincelada',
            type: 'combo',
            name: 'Combo no disponible',
            detail: '',
            unitPriceArs: 0,
            netUnitPriceArs: 0,
            kitSavingsArs: 0,
            totalArs: 0,
            maxQuantity: 0,
            issue: 'unavailable',
          },
        ],
        itemsGrossArs: 137996,
        kitSavingsArs: 13998,
        subtotalArs: 123998,
        netSubtotalArs: 102478,
      })
    })

    it('POST /cart/quote de "Dúo Imperial" (lleva mate) con options null → 422 en items.0.options', async () => {
      const response = await send(newJar(), 'post', '/cart/quote', {
        body: { items: [comboLine(duoId, 1, null)] },
      })

      expect(response.status).toBe(422)
      expect(response.body).toMatchObject({ type: 'validation_error' })
      expect((response.body as { errors: unknown }).errors).toEqual([
        {
          field: 'items.0.options',
          code: 'required',
          message: 'Elegí el cuero y la virola del mate.',
        },
      ])
    })

    it('POST /shipping/quote acepta un combo', async () => {
      const response = await send(newJar(), 'post', '/shipping/quote', {
        body: { method: 'home', postalCode: 'C1043', items: [comboLine(duoId)] },
      })

      expect(response.status).toBe(200)
      expect(response.body).toMatchObject({ method: 'home', costArs: 6500 })
    })

    it('POST /orders reserva cada pieza y GET /orders/{number} trae las piezas en el orden del combo', async () => {
      const mateBefore = await reservedOf(mate.id)
      const curvoBefore = await reservedOf(curvo.id)
      const { order, orderToken } = await createdOrder(
        newJar(),
        await orderBody([comboLine(duoId, 1, BROWN)], 'combo@ejemplo.com'),
      )
      const read = await send(newJar(), 'get', `/orders/${order.number}`, {
        headers: { 'X-Order-Token': orderToken },
      })

      expect(order.lines).toEqual([
        {
          type: 'combo',
          name: 'Dúo Imperial',
          detail: 'Mate Imperial Premium + Bombillón Premium Curvo · Cuero marrón · Acero',
          quantity: 1,
          unitPriceArs: 68998,
          kitSavingsArs: 6999,
          totalArs: 61999,
          productSlug: null,
          options: BROWN,
          kitItems: [
            { slug: 'mate-imperial-premium', name: 'Mate Imperial Premium', unitPriceArs: 39999 },
            {
              slug: 'bombillon-premium-curvo',
              name: 'Bombillón Premium Curvo',
              unitPriceArs: 28999,
            },
          ],
        },
      ])
      expect(order).toMatchObject({ itemsGrossArs: 68998, kitSavingsArs: 6999, subtotalArs: 61999 })
      expect(read.status).toBe(200)
      expect(read.body).toEqual(order)
      expect(await reservedOf(mate.id)).toBe(mateBefore + 1)
      expect(await reservedOf(curvo.id)).toBe(curvoBefore + 1)
    })

    it('Review Focus 1: el combo ×10 y el mate suelto ×5 comparten el stock; el pedido reserva 12 y 10', async () => {
      const result = await quote([comboLine(duoId, 10), mateLine(mate.id, 5)])
      const mateBefore = await reservedOf(mate.id)
      const curvoBefore = await reservedOf(curvo.id)
      await createdOrder(
        newJar(),
        await orderBody([comboLine(duoId, 10), mateLine(mate.id, 2)], 'compartido@ejemplo.com'),
      )

      expect(result.lines.map((line) => [line.issue, line.maxQuantity])).toEqual([
        [null, 12],
        ['quantity_reduced', 2],
      ])
      expect(await reservedOf(mate.id)).toBe(mateBefore + 12)
      expect(await reservedOf(curvo.id)).toBe(curvoBefore + 10)
    })

    it('409 price_changed con el precio viejo del combo, sin producto; nada reservado', async () => {
      const line = { ...comboLine(duoId), expectedUnitPriceArs: 59999 }
      const body = await orderBody([line], 'combo-precio@ejemplo.com')
      const mateBefore = await reservedOf(mate.id)

      const response = await placeOrder(newJar(), body)

      expect(response.status).toBe(409)
      expect(response.body).toMatchObject({
        type: 'price_changed',
        changes: [
          {
            kind: 'price',
            productId: null,
            message: 'Dúo Imperial cambió de precio: ahora cuesta $61.999.',
          },
        ],
      })
      expect(await reservedOf(mate.id)).toBe(mateBefore)
    })

    it('Review Focus 2: con una pieza archivada o dos del mismo grupo → 409 stock_changed, nunca 500', async () => {
      const body = await orderBody([comboLine(duoId)], 'combo-roto@ejemplo.com')
      const { categoryId } = await prisma().product.findUniqueOrThrow({
        where: { id: curvo.id },
        select: { categoryId: true },
      })
      const mateCategory = await prisma().product.findUniqueOrThrow({
        where: { id: mate.id },
        select: { categoryId: true },
      })

      try {
        await prisma().product.update({ where: { id: curvo.id }, data: { status: 'archived' } })
        const archived = await placeOrder(newJar(), body)
        await prisma().product.update({ where: { id: curvo.id }, data: { status: 'published' } })
        await prisma().product.update({
          where: { id: curvo.id },
          data: { categoryId: mateCategory.categoryId },
        })
        const sameGroup = await placeOrder(newJar(), body)
        const quoted = await quote([comboLine(duoId)])

        expect(archived.status).toBe(409)
        expect(archived.body).toMatchObject({
          type: 'stock_changed',
          changes: [
            {
              kind: 'unavailable',
              productId: curvo.id,
              message: 'Dúo Imperial ya no está disponible.',
            },
          ],
        })
        expect(sameGroup.status).toBe(409)
        expect(sameGroup.body).toMatchObject({
          type: 'stock_changed',
          changes: [
            {
              kind: 'unavailable',
              productId: null,
              message: 'Dúo Imperial ya no está disponible.',
            },
          ],
        })
        expect(quoted.lines[0]?.issue).toBe('unavailable')
      } finally {
        await prisma().product.update({
          where: { id: curvo.id },
          data: { status: 'published', categoryId },
        })
      }
    })

    it('Review Focus 4: un combo [yerba, mate] respeta ese orden en detail y en kitItems', async () => {
      const id = randomUUID()
      await prisma().combo.create({
        data: {
          id,
          name: 'Yerba y mate',
          description: 'Primero la yerba.',
          priceArs: 45999,
          status: 'published',
          position: 99,
          items: {
            create: [
              { position: 1, productId: yerba.id },
              { position: 2, productId: mate.id },
            ],
          },
        },
      })

      try {
        const result = await quote([comboLine(id)])
        const { order, orderToken } = await createdOrder(
          newJar(),
          await orderBody([comboLine(id)], 'yerba-mate@ejemplo.com'),
        )
        const read = await send(newJar(), 'get', `/orders/${order.number}`, {
          headers: { 'X-Order-Token': orderToken },
        })

        expect(result.lines[0]?.detail).toBe(
          'Yerba Canarias 1 kg + Mate Imperial Premium · Cuero negro · Alpaca cincelada',
        )
        expect(read.status).toBe(200)
        expect((read.body as OrderView).lines[0]?.kitItems?.map((piece) => piece.slug)).toEqual([
          'yerba-canarias-1-kg',
          'mate-imperial-premium',
        ])
      } finally {
        await prisma().combo.delete({ where: { id } })
      }
    })
  })
})
