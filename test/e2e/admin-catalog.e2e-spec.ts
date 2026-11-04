import type { INestApplication } from '@nestjs/common'
import type { Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { seed } from '../../prisma/seed'
import { SEED_ADMIN } from '../../prisma/seed-data/admin'
import type {
  AdminProduct,
  AdminProductPage,
  Category,
  ComboView,
  ProductDetail,
  ProductPage,
} from '../../src/modules/catalog/application/read-models'
import { OutboxRelay } from '../../src/shared/infrastructure/outbox/outbox.relay'
import { PrismaService } from '../../src/shared/infrastructure/prisma/prisma.service'
import { createApp } from '../support/app'
import { startContainers, type TestContainers } from '../support/containers'
import { type FakeStore, startFakeStore } from '../support/fake-store'
import { call, type CallOptions, firstError, type HttpMethod, newJar } from '../support/http'
import { mateLine, ordersHttp } from '../support/orders-http'

const SECRET = 's'.repeat(32)

const PREMIUM = 'mate-imperial-premium'

/** Aviso a la tienda que quedó en el outbox. */
interface StaleRow {
  aggregateId: string
  payload: unknown
}

/** Cuerpo de `PATCH /admin/products/{id}` armado desde lo guardado (como `republishInput`). */
function toInput(product: AdminProduct): Record<string, unknown> {
  return {
    name: product.name,
    slug: product.slug,
    categoryId: product.categoryId,
    description: product.description,
    priceArs: product.priceArs,
    stock: product.stock,
    featured: product.featured,
    status: product.status === 'archived' ? 'draft' : product.status,
    images: product.images.map(({ publicId, width, height, alt }) => ({
      publicId,
      width,
      height,
      alt,
    })),
    leathers: [...product.leathers],
    tabsOverride: product.tabsOverride,
  }
}

describe('productos y líneas del dashboard (HTTP + Postgres + Redis + tienda falsa)', () => {
  let containers: TestContainers | undefined
  let app: INestApplication<Server> | undefined
  let store: FakeStore | undefined
  const previousEnv = {
    DATABASE_URL: process.env.DATABASE_URL,
    REDIS_URL: process.env.REDIS_URL,
    STORE_ORIGIN: process.env.STORE_ORIGIN,
    STORE_REVALIDATE_SECRET: process.env.STORE_REVALIDATE_SECRET,
  }
  const admin = newJar()

  beforeAll(async () => {
    store = await startFakeStore()
    containers = await startContainers()
    process.env.DATABASE_URL = containers.databaseUrl
    process.env.REDIS_URL = containers.redisUrl
    process.env.STORE_ORIGIN = store.origin
    process.env.STORE_REVALIDATE_SECRET = SECRET
    app = await createApp()
    await seed(app.get(PrismaService))
    const login = await http('post', '/admin/auth/login', { body: SEED_ADMIN })
    expect(login.status).toBe(200)
    admin.csrf = (login.body as { csrfToken: string }).csrfToken
  })

  afterAll(async () => {
    await app?.close()
    await containers?.stop()
    await store?.close()
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

  function fakeStore(): FakeStore {
    if (store === undefined) throw new Error('La tienda falsa no arrancó')
    return store
  }

  /** Pedido como el dashboard (sesión de admin y CSRF, salvo que se pida otra cosa). */
  function http(method: HttpMethod, path: string, options: CallOptions = {}) {
    return call(server(), admin, method, path, options)
  }

  /** Pedido sin sesión (la tienda). */
  function anonymous(method: HttpMethod, path: string) {
    return call(server(), newJar(), method, path)
  }

  const { orderBody, createdOrder } = ordersHttp(server)

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

  async function page(query: string): Promise<AdminProductPage> {
    const response = await http('get', `/admin/products${query}`)
    expect(response.status, JSON.stringify(response.body)).toBe(200)
    return response.body as AdminProductPage
  }

  async function productBySlug(slug: string): Promise<AdminProduct> {
    const { id } = await prisma().product.findUniqueOrThrow({
      where: { slug },
      select: { id: true },
    })
    const response = await http('get', `/admin/products/${id}`)
    expect(response.status).toBe(200)
    return response.body as AdminProduct
  }

  async function categoryId(slug: string): Promise<string> {
    const row = await prisma().category.findUniqueOrThrow({ where: { slug }, select: { id: true } })
    return row.id
  }

  /** Un producto nuevo de la línea Imperiales. */
  async function newProduct(
    overrides: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    return {
      name: 'Mate Imperial Nuevo',
      slug: 'mate-imperial-nuevo',
      categoryId: await categoryId('imperiales'),
      description: 'Imperial nuevo cargado desde el dashboard.',
      priceArs: 45000,
      stock: 3,
      featured: false,
      status: 'published',
      images: [
        {
          publicId: 'galpon/productos/mate-imperial-nuevo',
          width: 800,
          height: 1000,
          alt: 'Nuevo',
        },
      ],
      leathers: ['Crudo', 'Negro'],
      tabsOverride: { materials: 'Calabaza y alpaca.', care: null },
      ...overrides,
    }
  }

  it('las lecturas piden la sesión de admin (401) y las escrituras también el CSRF (403)', async () => {
    expect((await anonymous('get', '/admin/products')).status).toBe(401)
    expect((await anonymous('get', '/admin/categories')).status).toBe(401)
    const { result, events } = await withEvents(async () =>
      http('post', '/admin/products', { body: await newProduct(), csrf: false }),
    )
    expect(result.status).toBe(403)
    expect(result.body).toMatchObject({ type: 'csrf_invalid' })
    expect(events).toEqual([])
  })

  it('GET /admin/products: por código, de a 24, con los filtros y los textos del mock', async () => {
    const first = await page('')
    expect(first).toMatchObject({ page: 1, pageSize: 24, total: 27 })
    expect(first.items).toHaveLength(24)
    expect(first.items.map((item) => item.sequence)).toEqual(
      Array.from({ length: 24 }, (_, index) => index + 1),
    )
    expect(first.items[0]).toMatchObject({ code: 'N°01', slug: PREMIUM, status: 'published' })

    expect((await page('?status=published&pageSize=100')).items).toHaveLength(27)
    expect((await page('?stock=out')).items.map((item) => item.slug)).toEqual(['mate-galleta'])
    expect((await page(`?q=${encodeURIComponent('n°07')}`)).items.map((item) => item.slug)).toEqual(
      ['mate-torpedo-linea-acero'],
    )
    expect((await page('?category=no-existe')).total).toBe(0)

    const stock = await http('get', '/admin/products?stock=all')
    expect(stock.status).toBe(422)
    expect(firstError(stock)).toEqual({
      field: 'stock',
      code: 'invalid_value',
      message: 'El stock tiene que ser out.',
    })
    const size = await http('get', '/admin/products?pageSize=101')
    expect(firstError(size)).toEqual({
      field: 'pageSize',
      code: 'too_big',
      message: 'El tamaño de página no puede pasar de 100.',
    })
    const text = await http('get', `/admin/products?q=${'a'.repeat(101)}`)
    expect(firstError(text)).toEqual({
      field: 'q',
      code: 'too_big',
      message: 'El texto no puede pasar de 100 caracteres.',
    })
    // Un error por parámetro, todos juntos y en el orden del mock.
    const many = await http(
      'get',
      '/admin/products?q=x&category=Mate_Imperial&sort=precio&status=x&page=0&pageSize=abc',
    )
    expect((many.body as { errors: unknown[] }).errors).toEqual([
      { field: 'page', code: 'too_small', message: 'La página tiene que ser mayor o igual a 1.' },
      {
        field: 'pageSize',
        code: 'invalid_type',
        message: 'El tamaño de página tiene que ser un número entero.',
      },
      {
        field: 'status',
        code: 'invalid_value',
        message: 'El estado tiene que ser draft, published, archived.',
      },
      {
        field: 'sort',
        code: 'invalid_value',
        message: 'El orden tiene que ser destacados, menor, mayor, az.',
      },
      {
        field: 'category',
        code: 'invalid_format',
        message: 'El slug solo puede tener minúsculas, números y guiones, y hasta 80 caracteres.',
      },
    ])
  })

  it('GET /admin/products/{id}: en cualquier estado, con lo que ve el dashboard; 404 si no existe', async () => {
    const premium = await productBySlug(PREMIUM)
    expect(premium).toMatchObject({
      sequence: 1,
      code: 'N°01',
      status: 'published',
      stock: 12,
      previousSlugs: [],
      tabsOverride: null,
      leathers: ['Negro', 'Marrón', 'Crudo', 'Borravino'],
    })
    expect(premium.images[0]).toMatchObject({
      publicId: 'galpon/productos/mate-imperial-premium',
      url: '/mock-images/mate-imperial-premium.jpg',
    })
    for (const id of ['0190a000-0000-7000-8000-0000000000ff', 'prd-imperial-premium']) {
      const missing = await http('get', `/admin/products/${id}`)
      expect(missing.status).toBe(404)
      expect(missing.body).toMatchObject({ type: 'not_found', detail: 'No existe ese producto.' })
    }
  })

  it('Review Focus 2: cambiar nombre y slug avisa una vez y la tienda lo ve al instante', async () => {
    const cachedDetail = await anonymous('get', `/products/${PREMIUM}`)
    expect(cachedDetail.status).toBe(200)
    expect((await anonymous('get', '/products?pageSize=100')).status).toBe(200)
    const premium = await productBySlug(PREMIUM)
    await app?.get(OutboxRelay).runOnce()
    fakeStore().requests.length = 0

    const { result, events } = await withEvents(() =>
      http('patch', `/admin/products/${premium.id}`, {
        body: {
          ...toInput(premium),
          name: 'Mate Imperial Renovado',
          slug: 'mate-imperial-renovado',
          expectedUpdatedAt: premium.updatedAt,
        },
      }),
    )
    expect(result.status, JSON.stringify(result.body)).toBe(200)
    expect(result.body).toMatchObject({
      name: 'Mate Imperial Renovado',
      slug: 'mate-imperial-renovado',
      previousSlugs: [PREMIUM],
    })
    const tags = [
      'products',
      'product:mate-imperial-renovado',
      `product:${PREMIUM}`,
      'categories',
      'combos',
    ]
    expect(events).toEqual([
      { aggregateId: 'product.updated', payload: { reason: 'product.updated', tags } },
    ])
    await app?.get(OutboxRelay).runOnce()
    await vi.waitFor(
      () => {
        expect(fakeStore().tags()).toEqual([tags])
      },
      {
        timeout: 15_000,
        interval: 200,
      },
    )

    const fresh = await anonymous('get', '/products/mate-imperial-renovado')
    expect((fresh.body as ProductDetail).name).toBe('Mate Imperial Renovado')
    const byOldSlug = await anonymous('get', `/products/${PREMIUM}`)
    expect(byOldSlug.body).toMatchObject({
      slug: 'mate-imperial-renovado',
      name: 'Mate Imperial Renovado',
    })
    const list = (await anonymous('get', '/products?pageSize=100')).body as ProductPage
    expect(list.items.find((item) => item.id === premium.id)?.name).toBe('Mate Imperial Renovado')

    // Un 422, un 403 o un 409 no guardan ni avisan nada.
    const saved = result.body as AdminProduct
    const { events: none } = await withEvents(async () => {
      const invalid = await http('patch', `/admin/products/${premium.id}`, {
        body: { ...toInput(saved), name: 'ab' },
      })
      expect(invalid.status).toBe(422)
      const csrf = await http('patch', `/admin/products/${premium.id}`, {
        body: toInput(saved),
        csrf: false,
      })
      expect(csrf.status).toBe(403)
      // product_changed gana a la línea que no existe, los cueros, la foto y el slug de otro.
      const changed = await http('patch', `/admin/products/${premium.id}`, {
        body: {
          ...toInput(saved),
          slug: 'mate-galleta',
          categoryId: '0190a000-0000-7000-8000-0000000000ff',
          images: [{ publicId: 'otra/foto', width: 1, height: 1, alt: 'Otra' }],
          expectedUpdatedAt: premium.updatedAt,
        },
      })
      expect(changed.status).toBe(409)
      expect(changed.body).toMatchObject({
        type: 'product_changed',
        title: 'El producto cambió',
        detail: 'El producto cambió desde que lo abriste.',
      })
      const taken = await http('patch', `/admin/products/${premium.id}`, {
        body: { ...toInput(saved), slug: 'mate-galleta' },
      })
      expect(taken.status).toBe(409)
      expect(taken.body).toMatchObject({
        type: 'slug_taken',
        title: 'El slug ya está en uso',
        detail: 'Ya hay algo con el slug mate-galleta.',
      })
    })
    expect(none).toEqual([])

    // Volver al slug anterior lo saca del historial y guarda el que tenía.
    const back = await http('patch', `/admin/products/${premium.id}`, {
      body: { ...toInput(saved), name: 'Mate Imperial Premium', slug: PREMIUM },
    })
    expect(back.status).toBe(200)
    expect(back.body).toMatchObject({ slug: PREMIUM, previousSlugs: ['mate-imperial-renovado'] })
  })

  it('Review Focus 1: el stock es lo disponible y guardar escribe on_hand = stock + reserved', async () => {
    const coquito = await productBySlug('mate-coquito-criollo')
    expect(coquito.stock).toBe(2)
    await createdOrder(newJar(), await orderBody([mateLine(coquito.id, 2)], 'reserva@example.com'))

    expect((await productBySlug('mate-coquito-criollo')).stock).toBe(0)
    expect((await page('?stock=out')).items.map((item) => item.slug)).toEqual([
      'mate-galleta',
      'mate-coquito-criollo',
    ])

    const updated = await http('patch', `/admin/products/${coquito.id}`, {
      body: { ...toInput(coquito), stock: 5 },
    })
    expect(updated.status, JSON.stringify(updated.body)).toBe(200)
    expect(updated.body).toMatchObject({ stock: 5, isSoldOut: false, maxQuantity: 5 })
    const inventory = await prisma().inventory.findUniqueOrThrow({
      where: { productId: coquito.id },
      select: { onHand: true, reserved: true },
    })
    expect(inventory).toEqual({ onHand: 7, reserved: 2 })

    // Bajar a 0 con reservas tampoco rompe `inventory_reserved_check`.
    const none = await http('patch', `/admin/products/${coquito.id}`, {
      body: { ...toInput(coquito), stock: 0 },
    })
    expect(none.status).toBe(200)
    expect(
      await prisma().inventory.findUniqueOrThrow({ where: { productId: coquito.id } }),
    ).toMatchObject({ onHand: 2, reserved: 2 })
  })

  it('POST /admin/products: correlativo 28, stock, fotos por uso y los 422/409 del mock', async () => {
    const repeated = Array.from({ length: 8 }, () => ({
      publicId: 'galpon/productos/mate-imperial-premium',
      width: 960,
      height: 1280,
      alt: 'La misma foto ocho veces',
    }))
    const { result, events } = await withEvents(async () =>
      http('post', '/admin/products', { body: await newProduct() }),
    )
    expect(result.status, JSON.stringify(result.body)).toBe(201)
    const created = result.body as AdminProduct
    expect(created).toMatchObject({
      sequence: 28,
      code: 'N°28',
      stock: 3,
      status: 'published',
      leathers: ['Negro', 'Crudo'],
      tabsOverride: { materials: 'Calabaza y alpaca.', care: null },
      previousSlugs: [],
    })
    expect(created.images).toEqual([
      {
        publicId: 'galpon/productos/mate-imperial-nuevo',
        url: 'https://res.cloudinary.com/galpon-mock/image/upload/galpon/productos/mate-imperial-nuevo',
        width: 800,
        height: 1000,
        alt: 'Nuevo',
      },
    ])
    expect(events).toEqual([
      {
        aggregateId: 'product.created',
        payload: {
          reason: 'product.created',
          tags: ['products', 'product:mate-imperial-nuevo', 'categories', 'combos'],
        },
      },
    ])
    const row = await prisma().product.findUniqueOrThrow({
      where: { id: created.id },
      select: { publishedAt: true, inventory: true },
    })
    expect(row.publishedAt).not.toBeNull()
    expect(row.inventory).toMatchObject({ onHand: 3, reserved: 0 })
    expect(
      await prisma().mediaAsset.findUniqueOrThrow({
        where: { publicId: 'galpon/productos/mate-imperial-nuevo' },
      }),
    ).toMatchObject({ provider: 'simulated', alt: 'Nuevo' })

    // La misma foto 8 veces (y la del Premium, que ya existe) no da 500: un asset, 8 usos.
    const eight = await http('post', '/admin/products', {
      body: await newProduct({ slug: 'mate-ocho-fotos', images: repeated, status: 'draft' }),
    })
    expect(eight.status, JSON.stringify(eight.body)).toBe(201)
    expect((eight.body as AdminProduct).images).toHaveLength(8)
    expect((eight.body as AdminProduct).images[0]).toMatchObject({
      url: '/mock-images/mate-imperial-premium.jpg',
      alt: 'La misma foto ocho veces',
    })
    const premium = await productBySlug(PREMIUM)
    expect(premium.images[0]?.alt).not.toBe('La misma foto ocho veces')

    const { events: none } = await withEvents(async () => {
      const taken = await http('post', '/admin/products', {
        body: await newProduct({ slug: PREMIUM }),
      })
      expect(taken.status).toBe(409)
      expect(taken.body).toMatchObject({
        type: 'slug_taken',
        detail: 'Ya hay algo con el slug mate-imperial-premium.',
      })
      const formerSlug = await http('post', '/admin/products', {
        body: await newProduct({ slug: 'mate-imperial-renovado' }),
      })
      expect(formerSlug.status).toBe(409)
      const bombilla = await http('post', '/admin/products', {
        body: await newProduct({
          slug: 'bombilla-con-cuero',
          categoryId: await categoryId('bombillones'),
          leathers: ['Negro'],
        }),
      })
      expect(bombilla.status).toBe(422)
      expect(firstError(bombilla)).toEqual({
        field: 'leathers',
        code: 'leathers_not_allowed',
        message: 'Solo los mates llevan cuero',
      })
      const image = await http('post', '/admin/products', {
        body: await newProduct({
          slug: 'mate-foto-ajena',
          images: [{ publicId: 'galpon/lineas/x', width: 1, height: 1, alt: 'Línea' }],
        }),
      })
      expect(firstError(image)).toEqual({
        field: 'images.0.publicId',
        code: 'unknown_image',
        message: 'La foto no existe: subila de nuevo',
      })
      const line = await http('post', '/admin/products', {
        body: await newProduct({ slug: 'mate-sin-linea', categoryId: 'cat-imperiales' }),
      })
      expect(firstError(line)).toEqual({
        field: 'categoryId',
        code: 'unknown_category',
        message: 'Esa línea no existe',
      })
    })
    expect(none).toEqual([])
  })

  it('archivar saca el producto (y su combo) de la tienda; publicar de nuevo conserva publishedAt', async () => {
    const before = (await anonymous('get', '/combos')).body as ComboView[]
    expect(before.map((combo) => combo.name)).toContain('Dúo Imperial')
    const premium = await productBySlug(PREMIUM)
    const { publishedAt } = await prisma().product.findUniqueOrThrow({
      where: { id: premium.id },
      select: { publishedAt: true },
    })

    const { result, events } = await withEvents(() =>
      http('post', `/admin/products/${premium.id}/archive`),
    )
    expect(result.status).toBe(200)
    expect(result.body).toMatchObject({ status: 'archived', isPurchasable: false })
    expect(events.map((event) => event.aggregateId)).toEqual(['product.archived'])
    const after = (await anonymous('get', '/combos')).body as ComboView[]
    expect(after.map((combo) => combo.name)).not.toContain('Dúo Imperial')
    expect((await anonymous('get', `/products/${PREMIUM}`)).status).toBe(404)
    expect((await page('?status=archived')).items.map((item) => item.slug)).toEqual([PREMIUM])
    expect((await page('?pageSize=100')).items.map((item) => item.slug)).not.toContain(PREMIUM)

    const archived = result.body as AdminProduct
    const back = await http('patch', `/admin/products/${premium.id}`, {
      body: { ...toInput(archived), status: 'published', expectedUpdatedAt: archived.updatedAt },
    })
    expect(back.status, JSON.stringify(back.body)).toBe(200)
    expect(back.body).toMatchObject({ status: 'published' })
    const row = await prisma().product.findUniqueOrThrow({
      where: { id: premium.id },
      select: { publishedAt: true },
    })
    expect(row.publishedAt).toEqual(publishedAt)
    expect((await anonymous('get', `/products/${PREMIUM}`)).status).toBe(200)
  })

  it('líneas: alta al final, foto por uso, grupo bloqueado, borrado, orden y la tienda al instante', async () => {
    const listed = await http('get', '/admin/categories')
    expect(listed.status).toBe(200)
    expect((listed.body as Category[]).map((line) => line.position)).toEqual([1, 2, 3, 4, 5, 6])
    expect((await anonymous('get', '/categories')).status).toBe(200)

    const { result, events } = await withEvents(() =>
      http('post', '/admin/categories', {
        body: {
          name: ' Calabazas ',
          slug: 'calabazas',
          group: 'mate',
          blurb: '',
          image: { publicId: 'galpon/lineas/calabazas', width: 800, height: 600, alt: 'Calabazas' },
        },
      }),
    )
    expect(result.status, JSON.stringify(result.body)).toBe(201)
    const created = result.body as Category
    expect(created).toMatchObject({ name: 'Calabazas', position: 7, productCount: 0 })
    expect(created.image?.url).toBe(
      'https://res.cloudinary.com/galpon-mock/image/upload/galpon/lineas/calabazas',
    )
    expect(events).toEqual([
      {
        aggregateId: 'category.created',
        payload: { reason: 'category.created', tags: ['categories', 'products'] },
      },
    ])
    const store = (await anonymous('get', '/categories')).body as Category[]
    expect(store.map((line) => line.slug)).toContain('calabazas')

    const imperiales = await categoryId('imperiales')
    const current = (listed.body as Category[])[0]
    const base = {
      name: current?.name,
      slug: 'imperiales',
      group: 'mate',
      blurb: current?.blurb,
      image: { ...current?.image, url: undefined, alt: 'Alt nuevo de la línea' },
    }
    const { events: none } = await withEvents(async () => {
      const taken = await http('post', '/admin/categories', {
        body: { ...base, image: null },
      })
      expect(taken.status).toBe(409)
      expect(taken.body).toMatchObject({ type: 'slug_taken' })
      const group = await http('patch', `/admin/categories/${imperiales}`, {
        body: { ...base, group: 'yerba' },
      })
      expect(group.status).toBe(422)
      expect(firstError(group)).toEqual({
        field: 'group',
        code: 'category_has_products',
        message: 'La línea tiene productos: mové los productos antes de cambiarle el grupo.',
      })
      const busy = await http('delete', `/admin/categories/${imperiales}`)
      expect(busy.status).toBe(409)
      expect(busy.body).toMatchObject({
        type: 'category_has_products',
        title: 'La línea tiene productos',
        detail: 'Mové o borrá los productos de la línea antes de borrarla.',
      })
      const image = await http('patch', `/admin/categories/${imperiales}`, {
        body: {
          ...base,
          image: { publicId: 'galpon/productos/otra', width: 1, height: 1, alt: 'Foto' },
        },
      })
      expect(firstError(image)).toMatchObject({ field: 'image.publicId', code: 'unknown_image' })
      const missing = await http('delete', '/admin/categories/cat-imperiales')
      expect(missing.status).toBe(404)
      expect(missing.body).toMatchObject({ detail: 'No existe esa línea.' })
    })
    expect(none).toEqual([])

    const kept = await http('patch', `/admin/categories/${imperiales}`, {
      body: { ...base, image: { ...base.image, url: undefined } },
    })
    expect(kept.status, JSON.stringify(kept.body)).toBe(200)
    expect((kept.body as Category).image).toMatchObject({
      url: '/mock-images/mate-imperial-premium.jpg',
      alt: 'Alt nuevo de la línea',
    })
    const premium = await productBySlug(PREMIUM)
    expect(premium.images[0]?.alt).not.toBe('Alt nuevo de la línea')

    const removed = await http('delete', `/admin/categories/${created.id}`)
    expect(removed.status).toBe(204)
    const after = (await http('get', '/admin/categories')).body as Category[]
    expect(after.map((line) => line.position)).toEqual([1, 2, 3, 4, 5, 6])

    const reversed = after.map((line) => line.id).reverse()
    const incomplete = await http('put', '/admin/categories/order', {
      body: { ids: reversed.slice(1) },
    })
    expect(firstError(incomplete)).toEqual({
      field: 'ids',
      code: 'invalid_value',
      message: 'El orden tiene que tener todas las líneas, una vez cada una.',
    })
    const ordered = await http('put', '/admin/categories/order', { body: { ids: reversed } })
    expect(ordered.status).toBe(204)
    const storeAfter = (await anonymous('get', '/categories')).body as Category[]
    expect(storeAfter.map((line) => line.id)).toEqual(reversed)
  })
})
