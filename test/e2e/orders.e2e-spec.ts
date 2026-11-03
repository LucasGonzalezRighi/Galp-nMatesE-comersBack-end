import type { INestApplication } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import type { Server } from 'node:http'
import type request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { seed } from '../../prisma/seed'
import type {
  CartQuote,
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

/** Producto del seed, con lo que usan los casos. */
interface SeedProduct {
  id: string
  name: string
  priceArs: number
}

/** Línea del carrito como la manda la tienda. */
type CartLine = Record<string, unknown>

/** Cuero y virola de un mate. */
const OPTIONS = { leather: 'Negro', ferrule: 'Alpaca cincelada' }

/** Dirección de domicilio completa (el envío a domicilio cuesta 6500 en el seed). */
const HOME = {
  street: 'Av. Corrientes',
  number: '1234',
  apartment: null,
  postalCode: 'C1043',
  city: 'CABA',
  province: 'CABA',
}

/** Costo del envío a domicilio en el seed. */
const HOME_SHIPPING_ARS = 6500

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

  function mateLine(id: string, quantity = 1): CartLine {
    return { type: 'product', productId: id, quantity, options: OPTIONS }
  }

  async function quote(items: CartLine[]): Promise<CartQuote> {
    const response = await send(newJar(), 'post', '/cart/quote', { body: { items } })
    expect(response.status).toBe(200)
    return response.body as CartQuote
  }

  /** Cuerpo de `POST /orders` con el total que cotiza el back (envío a domicilio). */
  async function orderBody(
    items: CartLine[],
    email: string,
  ): Promise<Record<string, unknown> & { expectedTotalArs: number }> {
    const { subtotalArs } = await quote(items)
    return {
      customer: { email, firstName: 'Lucía', lastName: 'Pérez', phone: null },
      shipping: { method: 'home', address: HOME },
      items,
      paymentMethod: 'mp_redirect',
      expectedTotalArs: subtotalArs + HOME_SHIPPING_ARS,
      website: '',
    }
  }

  function placeOrder(jar: Jar, body: unknown, key = randomUUID()): Promise<request.Response> {
    return send(jar, 'post', '/orders', { body, headers: { 'Idempotency-Key': key } })
  }

  async function createdOrder(jar: Jar, body: unknown): Promise<CreateOrderResultView> {
    const response = await placeOrder(jar, body)
    expect(response.status, JSON.stringify(response.body)).toBe(201)
    return response.body as CreateOrderResultView
  }

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
        shipping: { method: 'home', address: HOME, costArs: 6500, eta: '3 a 6 días hábiles' },
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
          options: OPTIONS,
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
})
