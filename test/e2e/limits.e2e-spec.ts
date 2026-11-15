import type { INestApplication } from '@nestjs/common'
import { Redis } from 'ioredis'
import { randomUUID } from 'node:crypto'
import type { Server } from 'node:http'
import { gzipSync } from 'node:zlib'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { seed } from '../../prisma/seed'
import { PrismaService } from '../../src/shared/infrastructure/prisma/prisma.service'
import { createApp } from '../support/app'
import { startContainers, type TestContainers } from '../support/containers'
import {
  call as httpCall,
  type CallOptions,
  type HttpMethod,
  type Jar,
  newJar,
} from '../support/http'
import { mateLine, ordersHttp } from '../support/orders-http'

/** Límite de las lecturas públicas por IP real (por minuto). */
const PUBLIC_READ_LIMIT = 300

/** Tope de errores por campo en un 422. */
const MAX_FIELD_ERRORS = 50

/** Tope de direcciones por cliente. */
const MAX_ADDRESSES = 20

/** Tope de reseñas pendientes por IP por día. */
const MAX_REVIEWS_PER_DAY = 5

/** Reseña válida como la manda la tienda. */
const REVIEW = {
  rating: 5,
  authorName: null,
  text: 'Un mate hermoso, llegó rápido.',
  website: null,
}

/** Dirección de la libreta como la manda la tienda. */
const HOME = {
  label: 'Casa',
  street: 'Av. Rivadavia',
  number: '4321',
  apartment: null,
  postalCode: '1406',
  city: 'Buenos Aires',
  province: 'CABA',
  isDefault: false,
} as const

/** Cabecera de un cliente detrás del proxy de confianza (cada test usa su propia IP). */
function from(ip: string): Record<string, string> {
  return { 'X-Forwarded-For': ip }
}

describe('límites y recursos (tanda C de la auditoría, HTTP + Postgres + Redis)', () => {
  let containers: TestContainers | undefined
  let app: INestApplication<Server> | undefined
  let redis: Redis | undefined
  let mateId = ''
  const previousEnv = {
    DATABASE_URL: process.env.DATABASE_URL,
    REDIS_URL: process.env.REDIS_URL,
    TRUST_PROXY: process.env.TRUST_PROXY,
  }

  beforeAll(async () => {
    containers = await startContainers()
    process.env.DATABASE_URL = containers.databaseUrl
    process.env.REDIS_URL = containers.redisUrl
    // supertest llega desde 127.0.0.1: hace de servidor de la tienda (proxy de confianza).
    process.env.TRUST_PROXY = 'loopback'
    app = await createApp()
    await seed(prisma())
    redis = new Redis(containers.redisUrl)
    const mate = await prisma().product.findUniqueOrThrow({
      where: { slug: 'mate-imperial-premium' },
      select: { id: true },
    })
    mateId = mate.id
  })

  afterAll(async () => {
    await redis?.quit()
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

  function send(
    jar: Jar,
    method: HttpMethod,
    path: string,
    options?: CallOptions,
  ): Promise<request.Response> {
    return httpCall(server(), jar, method, path, options)
  }

  async function listKeys(pattern: string): Promise<string[]> {
    if (redis === undefined) throw new Error('Redis no arrancó')
    return redis.keys(pattern)
  }

  /** Repite `GET path` `times` veces y devuelve los códigos. */
  async function repeatGet(
    path: string,
    times: number,
    headers: Record<string, string> = {},
  ): Promise<number[]> {
    const statuses: number[] = []
    for (let i = 0; i < times; i += 1) {
      statuses.push((await send(newJar(), 'get', path, { headers })).status)
    }
    return statuses
  }

  describe('NV-25 (32): límites por IP con TRUST_PROXY', () => {
    it('el login cuenta por la IP de X-Forwarded-For: otro cliente detrás de la tienda no hereda el 429', async () => {
      const statuses: number[] = []
      for (let i = 0; i < 21; i += 1) {
        const response = await send(newJar(), 'post', '/auth/login', {
          body: { email: 'nadie@ejemplo.com', password: 'una-clave-cualquiera' },
          headers: from('203.0.113.10'),
        })
        statuses.push(response.status)
      }
      const other = await send(newJar(), 'post', '/auth/login', {
        body: { email: 'nadie@ejemplo.com', password: 'una-clave-cualquiera' },
        headers: from('203.0.113.11'),
      })

      expect(statuses.slice(0, 20)).toEqual(Array<number>(20).fill(403))
      expect(statuses[20]).toBe(429)
      expect(other.status).toBe(403)
    })
  })

  describe('NV-09: bloqueo de login por cliente normalizado y tope por email', () => {
    /** Navegador con su CSRF (lo pide desde `ip`). */
    async function browserFrom(ip: string): Promise<Jar> {
      const jar = newJar()
      const csrf = await send(jar, 'get', '/auth/csrf', { headers: from(ip) })
      jar.csrf = (csrf.body as { csrfToken: string }).csrfToken
      return jar
    }

    /** Inicio de sesión desde `ip`. */
    function loginFrom(
      jar: Jar,
      ip: string,
      email: string,
      password: string,
    ): Promise<request.Response> {
      return send(jar, 'post', '/auth/login', { body: { email, password }, headers: from(ip) })
    }

    it('las direcciones de una misma red IPv6 /64 son un solo cliente: la décima falla bloquea a toda la red; otra /64 sigue', async () => {
      const jar = await browserFrom('2001:db8:9:1::1')
      const statuses: number[] = []
      for (let host = 1; host <= 10; host += 1) {
        const ip = `2001:db8:9:1::${host.toString(16)}`
        statuses.push((await loginFrom(jar, ip, 'red@ejemplo.com', 'no-es-la-clave-1')).status)
      }
      const sameNetwork = await loginFrom(
        jar,
        '2001:db8:9:1:ffff:ffff:ffff:fffe',
        'red@ejemplo.com',
        'no-es-la-clave-1',
      )
      const otherNetwork = await loginFrom(
        jar,
        '2001:db8:9:2::1',
        'red@ejemplo.com',
        'no-es-la-clave-1',
      )

      expect(statuses).toEqual([...Array<number>(9).fill(401), 429])
      expect(sameNetwork.status).toBe(429)
      expect(otherNetwork.status).toBe(401)
    })

    it('una IPv4 mapeada (::ffff:) cuenta como la misma IPv4', async () => {
      const jar = await browserFrom('203.0.113.20')
      const statuses: number[] = []
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const ip = attempt % 2 === 0 ? '::ffff:203.0.113.20' : '203.0.113.20'
        statuses.push((await loginFrom(jar, ip, 'mapeada@ejemplo.com', 'no-es-la-clave-1')).status)
      }

      expect(statuses).toEqual([...Array<number>(9).fill(401), 429])
    })

    it('rotando IPs, con 100 fallos en la hora el email queda frenado desde cualquier IP (429, también con la contraseña correcta)', async () => {
      const email = 'rotada@ejemplo.com'
      const password = 'mate-con-yerba-2026'
      const owner = await browserFrom('192.0.2.50')
      const registered = await send(owner, 'post', '/auth/register', {
        body: { email, firstName: 'Rita', lastName: 'Sosa', password },
        headers: from('192.0.2.50'),
      })
      expect(registered.status).toBe(201)

      const attacker = await browserFrom('198.51.100.200')
      const statuses: number[] = []
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const ip = `198.51.100.${String(100 + Math.floor(attempt / 9))}`
        statuses.push((await loginFrom(attacker, ip, email, 'no-es-la-clave-1')).status)
      }
      const fresh = await browserFrom('192.0.2.51')
      const locked = await loginFrom(fresh, '192.0.2.51', email, password)

      expect(statuses.slice(0, 99)).toEqual(Array<number>(99).fill(401))
      expect(statuses[99]).toBe(429)
      expect(locked.status).toBe(429)
      expect(locked.body).toMatchObject({ type: 'rate_limited', status: 429 })
      expect(Number(locked.headers['retry-after'])).toBeGreaterThan(3_000)
    })
  })

  describe('NV-16: rutas de pago con límite por IP real del cliente', () => {
    /** Pedido nuevo de la tienda (sin X-Forwarded-For) con su token. */
    async function newOrder(): Promise<{ number: string; token: string }> {
      const { orderBody, createdOrder } = ordersHttp(server)
      const { order, orderToken } = await createdOrder(
        newJar(),
        await orderBody([mateLine(mateId)], `pagos-${randomUUID()}@ejemplo.com`),
      )
      return { number: order.number, token: orderToken }
    }

    /** Repite `POST path` con el token del pedido; devuelve los códigos. */
    async function repeatPost(
      path: string,
      token: string,
      times: number,
      body?: object,
      headers: Record<string, string> = {},
    ): Promise<number[]> {
      const statuses: number[] = []
      for (let i = 0; i < times; i += 1) {
        const options = { headers: { ...headers, 'X-Order-Token': token } }
        const response = await send(
          newJar(),
          'post',
          path,
          body === undefined ? options : { ...options, body },
        )
        statuses.push(response.status)
      }
      return statuses
    }

    const INSTALLMENTS = { bin: '45031234', paymentTypeId: 'credit_card' }

    it('las cuotas dejan 60 por minuto al cliente y la 61 → 429; la tienda sin X-Forwarded-For no se cuenta', async () => {
      const { number, token } = await newOrder()
      const path = `/orders/${number}/payments/mercadopago/installments`

      const client = await repeatPost(path, token, 61, INSTALLMENTS, from('203.0.113.60'))
      const store = await repeatPost(path, token, 61, INSTALLMENTS)

      expect(client.slice(0, 60)).toEqual(Array<number>(60).fill(200))
      expect(client[60]).toBe(429)
      expect(store).toEqual(Array<number>(61).fill(200))
    })

    it('cancelar el intento deja 30 por minuto al cliente y el 31 → 429', async () => {
      const { number, token } = await newOrder()

      const statuses = await repeatPost(
        `/orders/${number}/cancel-payment`,
        token,
        31,
        undefined,
        from('203.0.113.61'),
      )

      expect(statuses.slice(0, 30)).toEqual(Array<number>(30).fill(204))
      expect(statuses[30]).toBe(429)
    })
  })

  describe('NV-17 (22): body parsers', () => {
    it('un JSON comprimido (Content-Encoding: gzip) → 415 problem+json en español', async () => {
      const body = gzipSync(JSON.stringify({ items: [mateLine(mateId)] }))
      const response = await request(server())
        .post('/api/v1/cart/quote')
        .set('Content-Type', 'application/json')
        .set('Content-Encoding', 'gzip')
        .send(body)

      expect(response.status).toBe(415)
      expect(response.headers['content-type']).toMatch(/^application\/problem\+json/)
      expect(response.body).toMatchObject({
        type: 'unsupported_media_type',
        detail: 'El formato del cuerpo del pedido no es soportado.',
      })
    })

    it('un formulario anidado a una ruta JSON no se interpreta como objetos: 422 sin errores en items.N', async () => {
      const form = [
        'items[0][type]=product',
        `items[0][productId]=${mateId}`,
        'items[0][quantity]=1',
        'items[0][options][leather]=Negro',
      ].join('&')
      const response = await request(server())
        .post('/api/v1/cart/quote')
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .send(form)

      const { errors } = response.body as { errors: { field: string }[] }
      expect(response.status).toBe(422)
      expect(errors.map(({ field }) => field)).toContain('items')
      expect(errors.filter(({ field }) => field.startsWith('items.'))).toEqual([])
    })

    it('un JSON de más de 100 kB → 413 con el texto en español', async () => {
      const response = await request(server())
        .post('/api/v1/cart/quote')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ items: [], relleno: 'x'.repeat(110 * 1024) }))

      expect(response.status).toBe(413)
      expect(response.body).toMatchObject({
        type: 'payload_too_large',
        detail: 'El cuerpo del pedido es demasiado grande.',
      })
    })
  })

  describe('NV-13 (1): claves de caché del listado acotadas', () => {
    it('búsquedas, tamaños de página sueltos y páginas vacías no crean claves; el listado de la tienda sí', async () => {
      const pattern = 'catalog:v*:products:list:*'
      const before = (await listKeys(pattern)).length

      const searches = await Promise.all([
        send(newJar(), 'get', '/products?q=imperial'),
        send(newJar(), 'get', '/products?q=calabaza&page=2'),
        send(newJar(), 'get', '/products?pageSize=7'),
        send(newJar(), 'get', '/products?page=9999'),
        send(newJar(), 'get', '/products?category=no-existe'),
      ])
      const afterNoise = (await listKeys(pattern)).length
      const store = await send(newJar(), 'get', '/products?page=1&pageSize=100')
      const afterStore = (await listKeys(pattern)).length

      expect(searches.map((response) => response.status)).toEqual([200, 200, 200, 200, 200])
      expect(afterNoise).toBe(before)
      expect(store.status).toBe(200)
      expect(afterStore).toBe(before + 1)
    })
  })

  describe('NV-18 (23): lecturas públicas con límite por IP real', () => {
    it(`un cliente pasa de ${String(PUBLIC_READ_LIMIT)} lecturas por minuto → 429; el servidor de la tienda (sin X-Forwarded-For) no se limita`, async () => {
      const client = await repeatGet(
        '/settings/public',
        PUBLIC_READ_LIMIT + 1,
        from('198.51.100.7'),
      )
      const store = await repeatGet('/settings/public', PUBLIC_READ_LIMIT + 1)

      expect(client.slice(0, PUBLIC_READ_LIMIT)).toEqual(Array<number>(PUBLIC_READ_LIMIT).fill(200))
      expect(client[PUBLIC_READ_LIMIT]).toBe(429)
      expect(store).toEqual(Array<number>(PUBLIC_READ_LIMIT + 1).fill(200))
    })
  })

  describe('NV-23 (30): validación acotada en el carrito', () => {
    it('5000 líneas inválidas → 422 con el error de líneas y como mucho 50 errores', async () => {
      const items = Array.from({ length: 5000 }, () => ({ type: 'kit' }))
      const response = await send(newJar(), 'post', '/cart/quote', { body: { items } })

      const { errors } = response.body as { errors: { field: string; code: string }[] }
      expect(response.status).toBe(422)
      expect(errors.length).toBeLessThanOrEqual(MAX_FIELD_ERRORS)
      expect(errors).toContainEqual(expect.objectContaining({ field: 'items', code: 'too_big' }))
    })
  })

  describe('NV-30 (24): libreta de direcciones con tope', () => {
    /** Registra una cuenta nueva y deja el jar con su sesión y su token CSRF. */
    async function registered(email: string, headers: Record<string, string>): Promise<Jar> {
      const jar = newJar()
      const csrf = await send(jar, 'get', '/auth/csrf', { headers })
      jar.csrf = (csrf.body as { csrfToken: string }).csrfToken
      const response = await send(jar, 'post', '/auth/register', {
        body: { email, firstName: 'Lía', lastName: 'Gómez', password: 'mate-con-yerba-2026' },
        headers,
      })
      expect(response.status).toBe(201)
      // El registro rota la sesión: el token CSRF anónimo ya no vale.
      const renewed = await send(jar, 'get', '/auth/csrf', { headers })
      jar.csrf = (renewed.body as { csrfToken: string }).csrfToken
      return jar
    }

    it(`la dirección ${String(MAX_ADDRESSES + 1)} → 422 address_book_full; la libreta queda en ${String(MAX_ADDRESSES)}`, async () => {
      const headers = from('192.0.2.30')
      const jar = await registered('libreta@ejemplo.com', headers)

      const statuses: number[] = []
      for (let i = 0; i < MAX_ADDRESSES; i += 1) {
        const created = await send(jar, 'post', '/me/addresses', {
          body: { ...HOME, label: `Casa ${String(i + 1)}` },
          headers,
        })
        statuses.push(created.status)
      }
      const extra = await send(jar, 'post', '/me/addresses', {
        body: { ...HOME, label: 'Una más' },
        headers,
      })
      const list = await send(jar, 'get', '/me/addresses', { headers })

      expect(statuses).toEqual(Array<number>(MAX_ADDRESSES).fill(201))
      expect(extra.status).toBe(422)
      expect(extra.body).toMatchObject({
        type: 'validation_error',
        errors: [{ field: 'addresses', code: 'address_book_full' }],
      })
      expect((list.body as unknown[]).length).toBe(MAX_ADDRESSES)
    })

    it('altas a la vez no pasan el tope: de 25 juntas quedan 20', async () => {
      const headers = from('192.0.2.31')
      const jar = await registered('libreta-rafaga@ejemplo.com', headers)

      const responses = await Promise.all(
        Array.from({ length: MAX_ADDRESSES + 5 }, (_, i) =>
          send(jar, 'post', '/me/addresses', {
            body: { ...HOME, label: `Ráfaga ${String(i + 1)}` },
            headers,
          }),
        ),
      )
      const list = await send(jar, 'get', '/me/addresses', { headers })

      const statuses = responses.map(({ status }) => status)
      expect(statuses.filter((status) => status === 201)).toHaveLength(MAX_ADDRESSES)
      expect(statuses.filter((status) => status === 422)).toHaveLength(5)
      expect((list.body as unknown[]).length).toBe(MAX_ADDRESSES)
    })
  })

  describe('NV-21 (28): reseñas pendientes con tope por IP', () => {
    it(`la reseña ${String(MAX_REVIEWS_PER_DAY + 1)} del día desde la misma IP → 429 con Retry-After; otra IP y la tienda siguen`, async () => {
      const path = '/products/mate-imperial-premium/reviews'
      const statuses: number[] = []
      for (let i = 0; i <= MAX_REVIEWS_PER_DAY; i += 1) {
        const response = await send(newJar(), 'post', path, {
          body: { ...REVIEW, text: `Reseña número ${String(i + 1)} del mismo cliente.` },
          headers: from('198.51.100.20'),
        })
        statuses.push(response.status)
      }
      const blocked = await send(newJar(), 'post', path, {
        body: REVIEW,
        headers: from('198.51.100.20'),
      })
      const other = await send(newJar(), 'post', path, {
        body: REVIEW,
        headers: from('198.51.100.21'),
      })

      expect(statuses).toEqual([...Array<number>(MAX_REVIEWS_PER_DAY).fill(202), 429])
      expect(blocked.status).toBe(429)
      expect(blocked.body).toMatchObject({ type: 'rate_limited' })
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0)
      expect(other.status).toBe(202)
    })
  })

  describe('NV-22 (29): lecturas de reseñas cacheadas', () => {
    it('las reseñas de la ficha y las destacadas salen de la caché (60 s, versión del catálogo)', async () => {
      const path = '/products/mate-imperial-premium/reviews'
      const first = await send(newJar(), 'get', path)
      const featured = await send(newJar(), 'get', '/reviews/featured')
      const approved = { product: { slug: 'mate-imperial-premium' }, status: 'approved' as const }
      const ids = (await prisma().review.findMany({ where: approved, select: { id: true } })).map(
        ({ id }) => id,
      )
      const featuredIds = (
        await prisma().review.findMany({ where: { featured: true }, select: { id: true } })
      ).map(({ id }) => id)
      expect(ids.length).toBeGreaterThan(0)
      expect(featuredIds.length).toBeGreaterThan(0)

      // Cambios por fuera de la moderación (que sube la versión): la caché los ignora hasta vencer.
      await prisma().review.updateMany({ where: { id: { in: ids } }, data: { status: 'pending' } })
      await prisma().review.updateMany({
        where: { id: { in: featuredIds } },
        data: { featured: false },
      })
      const second = await send(newJar(), 'get', path)
      const featuredAgain = await send(newJar(), 'get', '/reviews/featured')
      await prisma().review.updateMany({ where: { id: { in: ids } }, data: { status: 'approved' } })
      await prisma().review.updateMany({
        where: { id: { in: featuredIds } },
        data: { featured: true },
      })

      expect(first.status).toBe(200)
      expect(second.body).toEqual(first.body)
      expect(featuredAgain.body).toEqual(featured.body)
    })
  })

  describe('NV-11 (19): respuestas privadas sin caché', () => {
    function expectPrivate(response: request.Response): void {
      expect(response.headers['cache-control']).toBe('no-store')
      expect(String(response.headers.vary)).toMatch(/\bCookie\b/)
    }

    it('GET /auth/csrf, /me, /me/addresses y /orders/{number} → Cache-Control: no-store y Vary: Cookie', async () => {
      const jar = newJar()
      const headers = from('192.0.2.40')
      const csrf = await send(jar, 'get', '/auth/csrf', { headers })
      jar.csrf = (csrf.body as { csrfToken: string }).csrfToken
      await send(jar, 'post', '/auth/register', {
        body: {
          email: 'cabeceras@ejemplo.com',
          firstName: 'Ema',
          lastName: 'Ruiz',
          password: 'mate-con-yerba-2026',
        },
        headers,
      })
      const me = await send(jar, 'get', '/me', { headers })
      const addresses = await send(jar, 'get', '/me/addresses', { headers })

      const { orderBody, createdOrder } = ordersHttp(server)
      const { order, orderToken } = await createdOrder(
        newJar(),
        await orderBody([mateLine(mateId)], `cabeceras-${randomUUID()}@ejemplo.com`),
      )
      const byToken = await send(newJar(), 'get', `/orders/${order.number}`, {
        headers: { 'X-Order-Token': orderToken },
      })

      expect(csrf.status).toBe(200)
      expect(me.status).toBe(200)
      expect(addresses.status).toBe(200)
      expect(byToken.status).toBe(200)
      for (const response of [csrf, me, addresses, byToken]) expectPrivate(response)
    })

    it('las lecturas públicas no llevan no-store (la tienda las cachea)', async () => {
      const response = await send(newJar(), 'get', '/products')

      expect(response.status).toBe(200)
      expect(response.headers['cache-control']).toBeUndefined()
    })
  })
})
