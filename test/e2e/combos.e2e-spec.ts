import { getQueueToken } from '@nestjs/bullmq'
import type { INestApplication } from '@nestjs/common'
import type { Queue } from 'bullmq'
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { comboSeedId, seed } from '../../prisma/seed'
import { SEED_ADMIN } from '../../prisma/seed-data/admin'
import type { ComboView } from '../../src/modules/catalog/application/read-models'
import {
  STOREFRONT_REVALIDATE_QUEUE,
  type StorefrontRevalidateJobData,
} from '../../src/modules/storefront-sync/infrastructure/storefront-revalidate.queue'
import { OutboxRelay } from '../../src/shared/infrastructure/outbox/outbox.relay'
import { PrismaService } from '../../src/shared/infrastructure/prisma/prisma.service'
import { createApp } from '../support/app'
import { startContainers, type TestContainers } from '../support/containers'
import { call, type CallOptions, type HttpMethod, newJar } from '../support/http'

/** Secreto de la tienda falsa (`STORE_REVALIDATE_SECRET`, mínimo 32 caracteres). */
const SECRET = 's'.repeat(32)

/** Pedido que recibió la tienda falsa. */
interface StoreRequest {
  method: string
  url: string
  headers: IncomingHttpHeaders
  body: string
}

/** Id de un combo del seed por su clave del mock. */
const seeded = (key: string): string => comboSeedId({ key })

const DUO = seeded('cmb-duo-imperial')
const CAMIONERO = seeded('cmb-camionero-y-canarias')
const TORPEDO = seeded('cmb-torpedo-completo')
const BOMBILLA_Y_YERBA = seeded('cmb-bombilla-y-yerba')
const GALLETA = seeded('cmb-galleta-y-canarias')

/** UUID que no es de ningún combo ni producto. */
const MISSING_ID = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b'

const UNAVAILABLE = 'Elegí un producto publicado y con precio'
const ORDER_INCOMPLETE = 'El orden tiene que tener todos los combos, una vez cada uno.'

describe('combos de la tienda y del dashboard (HTTP + Postgres + Redis + tienda falsa)', () => {
  let containers: TestContainers | undefined
  let app: INestApplication<Server> | undefined
  const previousEnv = {
    DATABASE_URL: process.env.DATABASE_URL,
    REDIS_URL: process.env.REDIS_URL,
    STORE_ORIGIN: process.env.STORE_ORIGIN,
    STORE_REVALIDATE_SECRET: process.env.STORE_REVALIDATE_SECRET,
  }
  const admin = newJar()
  /** Lo que recibió la tienda falsa desde la última vez que se miró. */
  const storeRequests: StoreRequest[] = []
  /** Estados que va a responder la tienda falsa, en orden (después, 200). */
  const storeScript: number[] = []
  const store = createServer((request, response) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk: string) => {
      body += chunk
    })
    request.on('end', () => {
      const { method = '', url = '', headers } = request
      storeRequests.push({ method, url, headers, body })
      const status = storeScript.shift() ?? 200
      response.writeHead(status, { 'content-type': 'application/json' })
      response.end(
        JSON.stringify(status === 200 ? { revalidated: ['combos'] } : { error: 'No autorizado' }),
      )
    })
  })
  /** Ids de los productos del seed por slug. */
  let products: Record<string, string> = {}

  beforeAll(async () => {
    await new Promise<void>((resolve) => store.listen(0, '127.0.0.1', resolve))
    const { port } = store.address() as AddressInfo
    containers = await startContainers()
    process.env.DATABASE_URL = containers.databaseUrl
    process.env.REDIS_URL = containers.redisUrl
    process.env.STORE_ORIGIN = `http://127.0.0.1:${String(port)}`
    process.env.STORE_REVALIDATE_SECRET = SECRET
    app = await createApp()
    await seed(app.get(PrismaService))
    const rows = await prisma().product.findMany({ select: { id: true, slug: true } })
    products = Object.fromEntries(rows.map(({ id, slug }) => [slug, id]))
    const login = await http('post', '/admin/auth/login', { body: SEED_ADMIN })
    expect(login.status).toBe(200)
    admin.csrf = (login.body as { csrfToken: string }).csrfToken
  })

  afterAll(async () => {
    await app?.close()
    await containers?.stop()
    store.closeAllConnections()
    await new Promise<void>((resolve) => {
      store.close(() => {
        resolve()
      })
    })
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

  function product(slug: string): string {
    const id = products[slug]
    if (id === undefined) throw new Error(`No está el producto ${slug} en el seed`)
    return id
  }

  async function storeCombos(): Promise<ComboView[]> {
    const response = await anonymous('get', '/combos')
    expect(response.status).toBe(200)
    return response.body as ComboView[]
  }

  async function adminCombos(): Promise<ComboView[]> {
    const response = await http('get', '/admin/combos')
    expect(response.status).toBe(200)
    return response.body as ComboView[]
  }

  async function positions(): Promise<string[]> {
    return (await adminCombos()).map(({ id }) => id)
  }

  function comboEvents(): Promise<number> {
    return prisma().outboxEvent.count({ where: { type: 'combo.changed' } })
  }

  /**
   * Publica el outbox y espera que la tienda falsa reciba `count` avisos, cada uno un
   * `POST /api/revalidate` con el secreto y `{"tags":["combos"]}`. Después vacía la lista.
   */
  async function expectStoreNotified(count = 1): Promise<void> {
    await app?.get(OutboxRelay).runOnce()
    await vi.waitFor(
      () => {
        expect(storeRequests).toHaveLength(count)
      },
      { timeout: 15_000, interval: 200 },
    )
    for (const received of storeRequests) {
      expect(received).toMatchObject({
        method: 'POST',
        url: '/api/revalidate',
        body: '{"tags":["combos"]}',
      })
      expect(received.headers['x-revalidate-secret']).toBe(SECRET)
      expect(received.headers['content-type']).toContain('application/json')
    }
    storeRequests.length = 0
  }

  /** Cuerpo válido de un combo con el Mate Imperial y el Bombillón curvo. */
  function duoBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      name: 'Dúo Imperial',
      description: 'El imperial de ceremonia con el bombillón curvo de pico de bronce.',
      productIds: [product('mate-imperial-premium'), product('bombillon-premium-curvo')],
      priceArs: 61999,
      status: 'published',
      ...overrides,
    }
  }

  describe('GET /combos', () => {
    it('los 4 publicados del seed, por posición, con los derivados del mock', async () => {
      const combos = await storeCombos()

      expect(
        combos.map(({ id, position, listPriceArs, savingsArs, netPriceArs, items }) => ({
          id,
          position,
          listPriceArs,
          savingsArs,
          netPriceArs,
          slugs: items.map(({ slug }) => slug),
        })),
      ).toEqual([
        {
          id: DUO,
          position: 1,
          listPriceArs: 68998,
          savingsArs: 6999,
          netPriceArs: 51239,
          slugs: ['mate-imperial-premium', 'bombillon-premium-curvo'],
        },
        {
          id: CAMIONERO,
          position: 2,
          listPriceArs: 34998,
          savingsArs: 3499,
          netPriceArs: 26032,
          slugs: ['camionero-virola-de-aluminio', 'yerba-canarias-1-kg'],
        },
        {
          id: TORPEDO,
          position: 3,
          listPriceArs: 76498,
          savingsArs: 8499,
          netPriceArs: 56198,
          slugs: [
            'mate-torpedo-virola-de-alpaca-cincelada',
            'bombillon-100-alpaca',
            'yerba-canarias-serena-1-kg',
          ],
        },
        {
          id: BOMBILLA_Y_YERBA,
          position: 4,
          listPriceArs: 38499,
          savingsArs: 3500,
          netPriceArs: 28925,
          slugs: ['bombillon-100-alpaca', 'yerba-canarias-te-y-jengibre-1-kg'],
        },
      ])
      for (const combo of combos) {
        expect(combo).toMatchObject({ isPurchasable: true, isSoldOut: false, maxQuantity: 12 })
      }
      expect(combos[0]).toMatchObject({
        name: 'Dúo Imperial',
        priceArs: 61999,
        status: 'published',
        items: [
          {
            productId: product('mate-imperial-premium'),
            name: 'Mate Imperial Premium',
            group: 'mate',
            unitPriceArs: 39999,
            isPurchasable: true,
            maxQuantity: 12,
            image: { publicId: 'galpon/productos/mate-imperial-premium' },
          },
          { group: 'bombilla', unitPriceArs: 28999 },
        ],
      })
    })
  })

  describe('GET /admin/combos', () => {
    it('sin sesión → 401', async () => {
      expect((await anonymous('get', '/admin/combos')).status).toBe(401)
    })

    it('con sesión → los 5, con el borrador sin stock y sin poder comprarse', async () => {
      const combos = await adminCombos()

      expect(combos.map(({ id, position }) => [id, position])).toEqual([
        [DUO, 1],
        [CAMIONERO, 2],
        [TORPEDO, 3],
        [BOMBILLA_Y_YERBA, 4],
        [GALLETA, 5],
      ])
      expect(combos[4]).toMatchObject({
        status: 'draft',
        isPurchasable: false,
        isSoldOut: true,
        maxQuantity: 0,
        listPriceArs: 37998,
        savingsArs: 3999,
      })
    })
  })

  describe('guards y validación: un 4xx no escribe ni avisa a la tienda', () => {
    it('sin sesión → 401 en cada ruta del dashboard; sin CSRF → 403 en cada escritura', async () => {
      const before = await comboEvents()

      const anonymousCalls = [
        await anonymous('get', '/admin/combos'),
        await anonymous('post', '/admin/combos', { body: duoBody() }),
        await anonymous('put', '/admin/combos/order', { body: { ids: [DUO] } }),
        await anonymous('patch', `/admin/combos/${DUO}`, { body: duoBody() }),
        await anonymous('delete', `/admin/combos/${DUO}`),
      ]
      expect(anonymousCalls.map(({ status }) => status)).toEqual([401, 401, 401, 401, 401])
      const withoutCsrf = { csrf: false } as const
      expect(
        (await http('post', '/admin/combos', { ...withoutCsrf, body: duoBody() })).status,
      ).toBe(403)
      expect(
        (await http('patch', `/admin/combos/${DUO}`, { ...withoutCsrf, body: duoBody() })).status,
      ).toBe(403)
      expect(
        (await http('put', '/admin/combos/order', { ...withoutCsrf, body: { ids: [DUO] } })).status,
      ).toBe(403)
      expect((await http('delete', `/admin/combos/${DUO}`, withoutCsrf)).status).toBe(403)

      expect(await positions()).toEqual([DUO, CAMIONERO, TORPEDO, BOMBILLA_Y_YERBA, GALLETA])
      expect(await comboEvents()).toBe(before)
    })

    it('cuerpo inválido → 422 con el campo y el mensaje del front (productIds.1 incluido)', async () => {
      const shortName = await http('post', '/admin/combos', { body: duoBody({ name: 'Dú' }) })
      const blankProduct = await http('post', '/admin/combos', {
        body: duoBody({ productIds: [product('mate-imperial-premium'), ' '] }),
      })

      expect(shortName.status).toBe(422)
      expect(shortName.body).toMatchObject({
        type: 'validation_error',
        errors: [{ field: 'name', message: 'Mínimo 3 caracteres' }],
      })
      expect(blankProduct.status).toBe(422)
      expect(blankProduct.body).toMatchObject({
        errors: [{ field: 'productIds.1', code: 'required', message: 'Requerido' }],
      })
    })

    it('productos que no se venden → 422 en cada productIds.N', async () => {
      const response = await http('post', '/admin/combos', {
        body: duoBody({
          productIds: [MISSING_ID, 'prd-imperial-premium', product('mate-torpedo-linea-acero')],
        }),
      })

      expect(response.status).toBe(422)
      expect(response.body).toMatchObject({
        type: 'validation_error',
        detail: 'Revisá los campos marcados.',
        errors: [
          { field: 'productIds.0', code: 'product_unavailable', message: UNAVAILABLE },
          { field: 'productIds.1', code: 'product_unavailable', message: UNAVAILABLE },
          { field: 'productIds.2', code: 'product_unavailable', message: UNAVAILABLE },
        ],
      })
    })

    it('grupos repetidos y precio no menor que la suma → 422 en productIds y priceArs', async () => {
      const yerbas = await http('post', '/admin/combos', {
        body: duoBody({
          productIds: [product('yerba-canarias-1-kg'), product('yerba-canarias-serena-1-kg')],
          priceArs: 22499,
          status: 'draft',
        }),
      })
      const expensive = await http('post', '/admin/combos', {
        body: duoBody({ priceArs: 68998 }),
      })

      expect(yerbas.status).toBe(422)
      expect((yerbas.body as { errors: unknown }).errors).toEqual([
        {
          field: 'productIds',
          code: 'duplicate_group',
          message: 'Elegí productos de grupos distintos',
        },
        {
          field: 'priceArs',
          code: 'price_not_below_sum',
          message: 'El precio del combo tiene que ser menor que la suma de los productos ($22.499)',
        },
      ])
      expect(expensive.status).toBe(422)
      expect((expensive.body as { errors: unknown }).errors).toEqual([
        {
          field: 'priceArs',
          code: 'price_not_below_sum',
          message: 'El precio del combo tiene que ser menor que la suma de los productos ($68.998)',
        },
      ])
    })

    it('un producto repetido con otras mayúsculas también es repetido → 422 en productIds', async () => {
      const imperial = product('mate-imperial-premium')

      const response = await http('post', '/admin/combos', {
        body: duoBody({ productIds: [imperial.toUpperCase(), imperial] }),
      })

      expect(response.status).toBe(422)
      expect((response.body as { errors: unknown }).errors).toEqual([
        {
          field: 'productIds',
          code: 'array_unique',
          message: 'Cada producto tiene que aparecer una sola vez',
        },
      ])
    })

    it('después de los 4xx no hay eventos combo.changed y la tienda no recibió nada', async () => {
      expect(await comboEvents()).toBe(0)
      await expect(app?.get(OutboxRelay).runOnce()).resolves.toBe(0)
      expect(storeRequests).toEqual([])
    })
  })

  describe('escrituras: cada una responde, se ve al instante y avisa una vez a la tienda', () => {
    let created = ''

    it('POST → 201 al final del listado y un aviso', async () => {
      const response = await http('post', '/admin/combos', {
        body: duoBody({
          name: '  Curvo y Canarias  ',
          productIds: [product('bombillon-premium-curvo'), product('yerba-canarias-1-kg')],
          priceArs: 34999,
        }),
      })

      expect(response.status).toBe(201)
      const combo = response.body as ComboView
      expect(combo).toMatchObject({
        name: 'Curvo y Canarias',
        position: 6,
        listPriceArs: 38998,
        savingsArs: 3999,
        isPurchasable: true,
      })
      expect(combo.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/)
      created = combo.id
      expect((await storeCombos()).map(({ id }) => id)).toEqual([
        DUO,
        CAMIONERO,
        TORPEDO,
        BOMBILLA_Y_YERBA,
        created,
      ])
      await expectStoreNotified()
    })

    it('PATCH a un id que no existe o que no es UUID → 404 "No existe ese combo."', async () => {
      const missing = await http('patch', `/admin/combos/${MISSING_ID}`, { body: duoBody() })
      const mockId = await http('patch', '/admin/combos/cmb-duo-imperial', { body: duoBody() })

      for (const response of [missing, mockId]) {
        expect(response.status).toBe(404)
        expect(response.body).toMatchObject({ type: 'not_found', detail: 'No existe ese combo.' })
      }
      expect(await comboEvents()).toBe(1)
    })

    it('PATCH → 200, conserva la posición, el GET /combos siguiente ya lo trae y un aviso', async () => {
      const response = await http('patch', `/admin/combos/${created}`, {
        body: duoBody({
          name: 'Canarias y Curvo',
          description: 'Primero la yerba.',
          productIds: [product('yerba-canarias-1-kg'), product('bombillon-premium-curvo')],
          priceArs: 33000,
        }),
      })

      expect(response.status).toBe(200)
      expect(response.body).toMatchObject({ id: created, name: 'Canarias y Curvo', position: 6 })
      const fromStore = (await storeCombos()).find(({ id }) => id === created)
      expect(fromStore).toMatchObject({
        name: 'Canarias y Curvo',
        description: 'Primero la yerba.',
        priceArs: 33000,
        savingsArs: 5998,
        items: [{ slug: 'yerba-canarias-1-kg' }, { slug: 'bombillon-premium-curvo' }],
      })
      await expectStoreNotified()
    })

    it.each([
      ['un id de más', (ids: string[]) => [...ids, MISSING_ID]],
      ['uno de menos', (ids: string[]) => ids.slice(1)],
      ['uno repetido', (ids: string[]) => [...ids.slice(0, -1), ids[0] ?? '']],
      ['uno que no es UUID', (ids: string[]) => [...ids.slice(1), 'cmb-duo-imperial']],
    ])('PUT /order con %s → 422 sin cambios', async (_case, build) => {
      const before = await positions()

      const response = await http('put', '/admin/combos/order', { body: { ids: build(before) } })

      expect(response.status).toBe(422)
      expect(response.body).toMatchObject({ type: 'validation_error', errors: [{ field: 'ids' }] })
      expect(await positions()).toEqual(before)
      expect(await comboEvents()).toBe(2)
    })

    it('PUT /order con todos los combos falla con el texto del orden si sobra uno', async () => {
      const ids = [...(await positions()), MISSING_ID]

      const response = await http('put', '/admin/combos/order', { body: { ids } })

      expect((response.body as { errors: unknown }).errors).toEqual([
        { field: 'ids', code: 'invalid_value', message: ORDER_INCOMPLETE },
      ])
    })

    it('PUT /order → 204, position = lugar en ids y un aviso', async () => {
      const reversed = [...(await positions())].reverse()

      const response = await http('put', '/admin/combos/order', { body: { ids: reversed } })

      expect(response.status).toBe(204)
      const combos = await adminCombos()
      expect(combos.map(({ id }) => id)).toEqual(reversed)
      expect(combos.map(({ position }) => position)).toEqual([1, 2, 3, 4, 5, 6])
      await expectStoreNotified()
    })

    it('DELETE a un id que no existe o que no es UUID → 404', async () => {
      expect((await http('delete', `/admin/combos/${MISSING_ID}`)).status).toBe(404)
      expect((await http('delete', '/admin/combos/cmb-duo-imperial')).status).toBe(404)
      expect(await comboEvents()).toBe(3)
    })

    it('DELETE del segundo → 204, posiciones 1..n sin huecos y un aviso', async () => {
      const before = await positions()
      const second = before[1] ?? ''

      const response = await http('delete', `/admin/combos/${second}`)

      expect(response.status).toBe(204)
      const combos = await adminCombos()
      expect(combos.map(({ id }) => id)).toEqual(before.filter((id) => id !== second))
      expect(combos.map(({ position }) => position)).toEqual([1, 2, 3, 4, 5])
      await expectStoreNotified()
    })
  })

  describe('combo roto después de guardado (Review Focus 2)', () => {
    const curvo = (): string => product('bombillon-premium-curvo')

    it.each([
      ['una pieza archivada', { status: 'archived' as const }],
      ['una pieza "a consultar"', { priceArs: null }],
    ])(
      'con %s: la tienda no lo ve y el dashboard lo marca sin poder comprarse',
      async (_c, data) => {
        await prisma().product.update({ where: { id: curvo() }, data })
        try {
          expect((await storeCombos()).map(({ id }) => id)).not.toContain(DUO)
          expect((await adminCombos()).find(({ id }) => id === DUO)).toMatchObject({
            isPurchasable: false,
            maxQuantity: 0,
          })
        } finally {
          await prisma().product.update({
            where: { id: curvo() },
            data: { status: 'published', priceArs: 28999 },
          })
        }
      },
    )

    it('con una pieza movida a una línea del mismo grupo que otra: tampoco', async () => {
      const original = await prisma().product.findUniqueOrThrow({
        where: { id: curvo() },
        select: { categoryId: true },
      })
      const mates = await prisma().category.findFirstOrThrow({ where: { slug: 'imperiales' } })
      await prisma().product.update({ where: { id: curvo() }, data: { categoryId: mates.id } })
      try {
        expect((await storeCombos()).map(({ id }) => id)).not.toContain(DUO)
        expect((await adminCombos()).find(({ id }) => id === DUO)).toMatchObject({
          isPurchasable: false,
          maxQuantity: 0,
        })
      } finally {
        await prisma().product.update({
          where: { id: curvo() },
          data: { categoryId: original.categoryId },
        })
      }
      expect((await storeCombos()).map(({ id }) => id)).toContain(DUO)
    })
  })

  describe('la tienda que falla (aviso de punta a punta)', () => {
    it('con un 500 se reintenta y el segundo intento llega', async () => {
      storeScript.push(500)

      const response = await http('patch', `/admin/combos/${DUO}`, { body: duoBody() })

      expect(response.status).toBe(200)
      await expectStoreNotified(2)
    })

    it('con un 401 no se reintenta: el job queda fallido con un intento', async () => {
      storeScript.push(401)

      const response = await http('patch', `/admin/combos/${DUO}`, { body: duoBody() })

      expect(response.status).toBe(200)
      await expectStoreNotified(1)
      const event = await prisma().outboxEvent.findFirstOrThrow({
        where: { type: 'combo.changed' },
        orderBy: { occurredAt: 'desc' },
      })
      const queue = app?.get<Queue<StorefrontRevalidateJobData>>(
        getQueueToken(STOREFRONT_REVALIDATE_QUEUE),
      )
      await vi.waitFor(
        async () => {
          const job = await queue?.getJob(event.id)
          expect(await job?.getState()).toBe('failed')
          expect(job?.attemptsMade).toBe(1)
        },
        { timeout: 10_000, interval: 200 },
      )
      // Pasado el backoff (1 s), no hubo un segundo intento.
      await new Promise((resolve) => setTimeout(resolve, 1_500))
      expect(storeRequests).toEqual([])
    })
  })

  describe('ids en mayúsculas: un UUID existente es el mismo y se guarda en minúsculas', () => {
    it('POST y PATCH con productIds en mayúsculas → 201 y 200; PUT /order en mayúsculas → 204', async () => {
      const curvo = product('bombillon-premium-curvo')
      const canarias = product('yerba-canarias-1-kg')
      const upper = [curvo.toUpperCase(), canarias.toUpperCase()]

      const created = await http('post', '/admin/combos', {
        body: duoBody({ name: 'Curvo y Canarias', productIds: upper, priceArs: 34999 }),
      })

      expect(created.status).toBe(201)
      const { id } = created.body as ComboView
      expect((created.body as ComboView).items.map(({ productId }) => productId)).toEqual([
        curvo,
        canarias,
      ])
      await expectStoreNotified()

      const updated = await http('patch', `/admin/combos/${id.toUpperCase()}`, {
        body: duoBody({
          name: 'Canarias y Curvo',
          productIds: [...upper].reverse(),
          priceArs: 33000,
        }),
      })

      expect(updated.status).toBe(200)
      expect(updated.body).toMatchObject({ id, name: 'Canarias y Curvo' })
      const items = await prisma().comboItem.findMany({
        where: { comboId: id },
        orderBy: { position: 'asc' },
      })
      expect(items.map(({ productId }) => productId)).toEqual([canarias, curvo])
      const event = await prisma().outboxEvent.findFirstOrThrow({
        where: { type: 'combo.changed' },
        orderBy: { occurredAt: 'desc' },
      })
      expect(event).toMatchObject({ aggregateId: id, payload: { comboId: id, change: 'updated' } })
      await expectStoreNotified()

      const reversed = [...(await positions())].reverse()
      const reordered = await http('put', '/admin/combos/order', {
        body: { ids: reversed.map((comboId) => comboId.toUpperCase()) },
      })

      expect(reordered.status).toBe(204)
      expect(await positions()).toEqual(reversed)
      await expectStoreNotified()
    })
  })
})
