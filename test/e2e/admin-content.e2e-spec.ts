import type { INestApplication } from '@nestjs/common'
import type { Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { seed } from '../../prisma/seed'
import { SEED_ADMIN } from '../../prisma/seed-data/admin'
import type {
  AboutContent,
  HomeContent,
  LegalContent,
  ProductTabsContent,
} from '../../src/modules/content/application/read-models'
import type { AdminSettings } from '../../src/modules/settings/application/read-models'
import { PrismaService } from '../../src/shared/infrastructure/prisma/prisma.service'
import { createApp } from '../support/app'
import { startContainers, type TestContainers } from '../support/containers'
import { call, type CallOptions, firstError, type HttpMethod, newJar } from '../support/http'

/** Aviso a la tienda que quedó en el outbox. */
interface StaleRow {
  aggregateId: string
  payload: unknown
}

describe('contenidos y ajustes del dashboard (HTTP + Postgres + Redis)', () => {
  let containers: TestContainers | undefined
  let app: INestApplication<Server> | undefined
  const previousEnv = {
    DATABASE_URL: process.env.DATABASE_URL,
    REDIS_URL: process.env.REDIS_URL,
  }
  const admin = newJar()
  let adminId = ''

  beforeAll(async () => {
    containers = await startContainers()
    process.env.DATABASE_URL = containers.databaseUrl
    process.env.REDIS_URL = containers.redisUrl
    app = await createApp()
    await seed(app.get(PrismaService))
    const login = await http('post', '/admin/auth/login', { body: SEED_ADMIN })
    expect(login.status).toBe(200)
    admin.csrf = (login.body as { csrfToken: string }).csrfToken
    const user = await prisma().user.findUniqueOrThrow({
      where: { email: SEED_ADMIN.email },
      select: { id: true },
    })
    adminId = user.id
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

  /** Pedido sin sesión (la tienda). */
  function anonymous(method: HttpMethod, path: string) {
    return call(server(), newJar(), method, path)
  }

  /** Avisos `storefront.stale` del outbox, en el orden en que se escribieron. */
  async function staleEvents(): Promise<StaleRow[]> {
    return prisma().outboxEvent.findMany({
      where: { type: 'storefront.stale' },
      orderBy: { id: 'asc' },
      select: { aggregateId: true, payload: true },
    })
  }

  /** Corre una escritura y devuelve la respuesta y los avisos nuevos que dejó en el outbox. */
  async function withEvents<T>(
    write: () => Promise<T>,
  ): Promise<{ result: T; events: StaleRow[] }> {
    const before = (await staleEvents()).length
    const result = await write()
    return { result, events: (await staleEvents()).slice(before) }
  }

  async function adminContent<T>(path: string): Promise<T> {
    const response = await http('get', `/admin/content/${path}`)
    expect(response.status).toBe(200)
    return response.body as T
  }

  it('las lecturas piden la sesión de admin (401) y los guardados también el CSRF (403)', async () => {
    const home = await adminContent<HomeContent>('home')
    expect((await anonymous('get', '/admin/content/home')).status).toBe(401)
    expect((await anonymous('get', '/admin/settings')).status).toBe(401)
    const { result, events } = await withEvents(() =>
      http('put', '/admin/content/home', { body: home, csrf: false }),
    )
    expect(result.status).toBe(403)
    expect(result.body).toMatchObject({ type: 'csrf_invalid' })
    expect(events).toEqual([])
  })

  it('PUT home guarda lo normalizado, la tienda ya lo ve y avisa content:home', async () => {
    const before = await anonymous('get', '/content/home')
    expect(before.status).toBe(200)
    const home = await adminContent<HomeContent>('home')
    const scenes = home.scenes.map((scene, index) =>
      index === 1 ? { ...scene, ctaLabel: '  ' } : scene,
    )
    const body = { ...home, hero: { ...home.hero, eyebrow: '  Hechos para compartir  ' }, scenes }
    const { result, events } = await withEvents(() => http('put', '/admin/content/home', { body }))
    expect(result.status).toBe(200)
    const saved = result.body as HomeContent
    expect(saved.hero.eyebrow).toBe('Hechos para compartir')
    expect(saved.scenes[1]?.ctaLabel).toBeNull()
    expect(events).toEqual([
      {
        aggregateId: 'content.updated',
        payload: { reason: 'content.updated', tags: ['content:home'] },
      },
    ])
    // La lectura pública estaba en la caché: el guardado la borró.
    const after = await anonymous('get', '/content/home')
    expect(after.body).toEqual(saved)
    expect(await adminContent<HomeContent>('home')).toEqual(saved)
    const block = await prisma().contentBlock.findUniqueOrThrow({
      where: { key: 'home' },
      select: { version: true, updatedBy: true },
    })
    expect(block).toEqual({ version: 2, updatedBy: adminId })
  })

  it('PUT home inválido da 422 con el mensaje del front y no avisa nada', async () => {
    const home = await adminContent<HomeContent>('home')
    const { result, events } = await withEvents(() =>
      http('put', '/admin/content/home', {
        body: { ...home, scenes: home.scenes.slice(0, 5), stats: { provinces: 1000, partners: 2 } },
      }),
    )
    expect(result.status).toBe(422)
    expect((result.body as { errors: unknown[] }).errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'scenes', message: 'Tienen que ser 6 escenas' }),
        expect.objectContaining({
          field: 'stats.provinces',
          message: 'Ingresá un número entero entre 0 y 999',
        }),
      ]),
    )
    expect(events).toEqual([])
  })

  it('PUT product-tabs: la ficha ya trae el envío nuevo y avisa también products', async () => {
    const product = await anonymous('get', '/products/mate-imperial-premium')
    expect(product.status).toBe(200)
    const tabs = await adminContent<ProductTabsContent>('product-tabs')
    const shipping = 'Envíos a todo el país en 48 horas.'
    const { result, events } = await withEvents(() =>
      http('put', '/admin/content/product-tabs', { body: { ...tabs, shipping } }),
    )
    expect(result.status).toBe(200)
    expect(events.map(({ payload }) => payload)).toEqual([
      { reason: 'content.updated', tags: ['content:product-tabs', 'products'] },
    ])
    const after = await anonymous('get', '/products/mate-imperial-premium')
    expect((after.body as { tabs: { shipping: string } }).tabs.shipping).toBe(shipping)
  })

  it('PUT about arma la url de una foto nueva de galpon/socios/ y rechaza una de otra carpeta', async () => {
    const about = await adminContent<AboutContent>('about')
    const photo = { publicId: 'galpon/socios/lucas', width: 800, height: 800, alt: 'Lucas' }
    const partners = about.partners.map((partner, index) =>
      index === 0 ? { ...partner, photo } : { ...partner, photo: null },
    )
    const { result, events } = await withEvents(() =>
      http('put', '/admin/content/about', { body: { ...about, partners } }),
    )
    expect(result.status).toBe(200)
    expect((result.body as AboutContent).partners[0]?.photo).toEqual({
      ...photo,
      url: 'https://res.cloudinary.com/galpon-mock/image/upload/galpon/socios/lucas',
    })
    expect(events.map(({ payload }) => payload)).toEqual([
      { reason: 'content.updated', tags: ['content:about'] },
    ])
    expect((await anonymous('get', '/content/about')).body).toEqual(result.body)

    const wrong = about.partners.map((partner) => ({
      ...partner,
      photo: { ...photo, publicId: 'galpon/productos/mate' },
    }))
    const rejected = await withEvents(() =>
      http('put', '/admin/content/about', { body: { ...about, partners: wrong } }),
    )
    expect(rejected.result.status).toBe(422)
    expect(rejected.result.body).toMatchObject({
      type: 'validation_error',
      errors: [
        {
          field: 'partners.0.photo.publicId',
          code: 'unknown_image',
          message: 'La foto no existe: subila de nuevo',
        },
      ],
    })
    expect(rejected.events).toEqual([])
  })

  it('legal: avisa su documento; otro da 404 y una fecha que no existe, 422', async () => {
    const terms = await adminContent<LegalContent>('legal/terms')
    const body = { ...terms, title: 'Términos y condiciones', updatedAt: '2026-11-04' }
    const { result, events } = await withEvents(() =>
      http('put', '/admin/content/legal/terms', { body }),
    )
    expect(result.status).toBe(200)
    expect(events.map(({ payload }) => payload)).toEqual([
      { reason: 'content.updated', tags: ['content:legal-terms'] },
    ])
    expect((await anonymous('get', '/content/legal/terms')).body).toEqual(body)

    const cookies = await withEvents(() => http('put', '/admin/content/legal/otro', { body }))
    expect(cookies.result.status).toBe(404)
    expect(cookies.result.body).toMatchObject({ detail: 'No existe ese documento legal.' })
    expect((await http('get', '/admin/content/legal/otro')).status).toBe(404)

    const date = await withEvents(() =>
      http('put', '/admin/content/legal/privacy', { body: { ...body, updatedAt: '2026-02-30' } }),
    )
    expect(date.result.status).toBe(422)
    expect(date.result.body).toMatchObject({
      errors: [{ field: 'updatedAt', message: 'Ingresá una fecha válida (AAAA-MM-DD)' }],
    })
    expect([...cookies.events, ...date.events]).toEqual([])
  })

  it('legal: cookies y returns guardan los marcadores tal cual; un marcador que no existe, 422', async () => {
    const returns = await adminContent<LegalContent>('legal/returns')
    expect(returns.title).toBe('Cambios, devoluciones y arrepentimiento')
    const cookies = await adminContent<LegalContent>('legal/cookies')
    const body = { ...cookies, body: '## Quién responde\n\n{{razon_social}}, CUIT {{cuit}}.' }
    const saved = await withEvents(() => http('put', '/admin/content/legal/cookies', { body }))
    expect(saved.result.status).toBe(200)
    expect(saved.result.body).toEqual(body)
    expect(saved.events.map(({ payload }) => payload)).toEqual([
      { reason: 'content.updated', tags: ['content:legal-cookies'] },
    ])
    expect((await anonymous('get', '/content/legal/cookies')).body).toEqual(body)

    const unknown = await withEvents(() =>
      http('put', '/admin/content/legal/terms', {
        body: { ...body, body: 'CUIT {{cuitt}} y {{otro}}.' },
      }),
    )
    expect(unknown.result.status).toBe(422)
    expect(unknown.result.body).toMatchObject({
      errors: [
        {
          field: 'body',
          code: 'custom',
          message: 'El dato {{cuitt}} no existe. Revisá la lista de datos del vendedor.',
        },
      ],
    })
    expect(unknown.events).toEqual([])
  })

  it('PUT settings: envíos en orden con su nombre, CUIT con 11 dígitos, IVA con 2 decimales', async () => {
    const current = (await http('get', '/admin/settings')).body as AdminSettings
    expect(current.lowStockThreshold).toEqual(expect.any(Number))
    const [home, branch, pickup] = current.shippingOptions
    if (home === undefined || branch === undefined || pickup === undefined) {
      throw new Error('Faltan envíos en el seed')
    }
    const option = ({ method, costArs, eta, enabled }: typeof home) => ({
      method,
      label: 'Otro nombre',
      costArs: method === 'branch' ? 3333 : costArs,
      eta,
      enabled,
    })
    const body = {
      ...current,
      kitDiscountPercent: 15,
      shippingOptions: [option(pickup), option(branch), option(home)],
      vatRatePercent: 10.555,
      seller: { ...current.seller, cuit: '20-12345678-6' },
    }
    const { result, events } = await withEvents(() => http('put', '/admin/settings', { body }))
    expect(result.status).toBe(200)
    const saved = result.body as AdminSettings
    expect(saved.shippingOptions).toEqual([home, { ...branch, costArs: 3333 }, pickup])
    expect(saved).toMatchObject({ kitDiscountPercent: 15, vatRatePercent: 10.56 })
    expect(saved.seller.cuit).toBe('20123456786')
    expect(events).toEqual([
      {
        aggregateId: 'settings.updated',
        payload: { reason: 'settings.updated', tags: ['settings', 'products', 'combos'] },
      },
    ])
    expect((await http('get', '/admin/settings')).body).toEqual(saved)
    const publicSettings = await anonymous('get', '/settings/public')
    expect(publicSettings.body).toMatchObject({
      kitDiscountPercent: 15,
      shippingOptions: saved.shippingOptions,
    })
    const row = await prisma().settings.findUniqueOrThrow({
      where: { id: 1 },
      select: { version: true, updatedBy: true },
    })
    expect(row).toEqual({ version: 2, updatedBy: adminId })

    const two = await withEvents(() =>
      http('put', '/admin/settings', {
        body: { ...body, shippingOptions: body.shippingOptions.slice(0, 2) },
      }),
    )
    expect(two.result.status).toBe(422)
    expect(two.result.body).toMatchObject({
      errors: [
        { field: 'shippingOptions', message: 'Cargá los tres métodos de envío, uno de cada tipo' },
      ],
    })
    expect(two.events).toEqual([])
  })

  it('PUT settings: consumerLinks es obligatorio y Data Fiscal guarda solo el href de ARCA', async () => {
    const current = (await http('get', '/admin/settings')).body as AdminSettings
    const withoutLinks: Partial<AdminSettings> = { ...current }
    delete withoutLinks.consumerLinks
    const missing = await withEvents(() => http('put', '/admin/settings', { body: withoutLinks }))
    expect(missing.result.status).toBe(422)
    expect(firstError(missing.result)).toMatchObject({
      field: 'consumerLinks',
      message: 'Requerido',
    })
    expect(missing.events).toEqual([])

    const href = 'https://qr.afip.gob.ar/?qr=abc123&x=1'
    const consumerLinks = {
      cabaUrl: 'https://caba.example/',
      nationalUrl: 'https://nacion.example/',
    }
    const code =
      '<a href="https://qr.afip.gob.ar/?qr=abc123&amp;x=1" target="_F960AFIPInfo">' +
      '<img src="https://www.afip.gob.ar/images/f960/DATAWEB.jpg" border="0"></a>'
    const body = { ...current, consumerLinks, seller: { ...current.seller, dataFiscalUrl: code } }
    const saved = await http('put', '/admin/settings', { body })
    expect(saved.status).toBe(200)
    expect((saved.body as AdminSettings).seller.dataFiscalUrl).toBe(href)
    expect((await anonymous('get', '/settings/public')).body).toMatchObject({
      consumerLinks,
      seller: { dataFiscalUrl: href },
    })
  })
})
