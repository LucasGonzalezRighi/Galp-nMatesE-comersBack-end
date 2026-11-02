import type { INestApplication } from '@nestjs/common'
import { Redis } from 'ioredis'
import type { Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { seed } from '../../prisma/seed'
import { GetProductQuery } from '../../src/modules/catalog/application/queries/get-product.query'
import { GetRelatedProductsQuery } from '../../src/modules/catalog/application/queries/get-related-products.query'
import { ListCategoriesQuery } from '../../src/modules/catalog/application/queries/list-categories.query'
import { ListProductsQuery } from '../../src/modules/catalog/application/queries/list-products.query'
import type { ProductFilter } from '../../src/modules/catalog/application/ports/product.repository.port'
import { GetContentQuery } from '../../src/modules/content/application/queries/get-content.query'
import { ListFeaturedReviewsQuery } from '../../src/modules/reviews/application/queries/list-featured-reviews.query'
import { ListProductReviewsQuery } from '../../src/modules/reviews/application/queries/list-product-reviews.query'
import { GetPublicSettingsQuery } from '../../src/modules/settings/application/queries/get-public-settings.query'
import { PrismaService } from '../../src/shared/infrastructure/prisma/prisma.service'
import { createApp } from '../support/app'
import { startContainers, type TestContainers } from '../support/containers'

/** Mates por precio ascendente: el filtro del plan (Task 8, paso 3). */
const MATES_BY_PRICE: ProductFilter = { group: 'mate', sort: 'menor', page: 1, pageSize: 100 }

describe('lecturas del catálogo, contenidos, reseñas y ajustes (Postgres + Redis)', () => {
  let containers: TestContainers | undefined
  let app: INestApplication<Server> | undefined
  let redis: Redis | undefined
  const previousEnv = { DATABASE_URL: process.env.DATABASE_URL, REDIS_URL: process.env.REDIS_URL }

  beforeAll(async () => {
    containers = await startContainers()
    process.env.DATABASE_URL = containers.databaseUrl
    process.env.REDIS_URL = containers.redisUrl
    app = await createApp()
    await seed(app.get(PrismaService))
    redis = new Redis(containers.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 })
    await redis.connect()
  })

  afterAll(async () => {
    redis?.disconnect()
    await app?.close()
    await containers?.stop()
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) Reflect.deleteProperty(process.env, key)
      else process.env[key] = value
    }
  })

  /** Saca un servicio de la app ya armada. */
  function get<T>(token: new (...args: never[]) => T): T {
    if (app === undefined) throw new Error('La app no arrancó')
    return app.get(token)
  }

  /** Cliente de Redis del test. */
  function cache(): Redis {
    if (redis === undefined) throw new Error('Redis no se conectó en beforeAll')
    return redis
  }

  it('lista los 16 mates por precio ascendente, con los "a consultar" al final', async () => {
    const page = await get(ListProductsQuery).execute(MATES_BY_PRICE)

    expect(page).toMatchObject({ page: 1, pageSize: 100, total: 16 })
    expect(page.items).toHaveLength(16)
    const prices = page.items.map(({ priceArs }) => priceArs)
    expect(prices.at(-1)).toBeNull()
    const priced = prices.filter((price) => price !== null)
    expect(priced).toEqual(priced.toSorted((a, b) => a - b))
    expect(page.items.every(({ group }) => group === 'mate')).toBe(true)
  })

  it('trae la ficha del Imperial Premium con 2 fotos, rating 4,7 y precio sin IVA', async () => {
    const product = await get(GetProductQuery).execute('mate-imperial-premium')

    expect(product).toMatchObject({
      code: 'N°01',
      categorySlug: 'imperiales',
      priceArs: 39999,
      netPriceArs: 33057,
      isPurchasable: true,
      rating: { count: 3 },
    })
    expect(product?.images).toHaveLength(2)
    expect(product?.mainImage).toEqual(product?.images[0])
    expect(product?.rating.average).toBe(14 / 3)
    expect(product?.rating.average.toFixed(1)).toBe('4.7')
    expect(product?.options?.ferrules).toHaveLength(3)
    expect(product?.tabs.shipping).toMatch(/Enviamos a todo el país/)
  })

  it('guarda las lecturas en Redis con las claves y TTL de cada módulo', async () => {
    const keys = await cache().keys('*')
    expect(keys).toEqual(
      expect.arrayContaining([
        'catalog:products:slug:mate-imperial-premium',
        'settings:store',
        'content:product-tabs',
      ]),
    )
    const listKey = keys.find((key) => key.startsWith('catalog:products:list:'))
    expect(listKey).toContain('"menor"')
    expect(await cache().ttl(listKey ?? '')).toBeLessThanOrEqual(60)
    expect(await cache().ttl('settings:store')).toBeGreaterThan(60)
    expect(await cache().ttl('content:product-tabs')).toBeLessThanOrEqual(300)
  })

  it('busca sin acentos ni mayúsculas en nombre, descripción y línea', async () => {
    const list = get(ListProductsQuery)
    const byName = await list.execute({
      q: 'BOMBILLON',
      sort: 'destacados',
      page: 1,
      pageSize: 100,
    })
    const byLine = await list.execute({
      q: 'imperiales',
      sort: 'destacados',
      page: 1,
      pageSize: 100,
    })
    const none = await list.execute({ q: 'zzz', sort: 'destacados', page: 1, pageSize: 100 })
    const withNul = await list.execute({ q: '\u0000', sort: 'destacados', page: 1, pageSize: 100 })

    expect(withNul).toMatchObject({ items: [], total: 0 })
    expect(byName.total).toBe(8)
    expect(byName.items.every(({ categorySlug }) => categorySlug === 'bombillones')).toBe(true)
    expect(byLine.items.map(({ categorySlug }) => categorySlug)).toContain('imperiales')
    expect(none).toMatchObject({ items: [], total: 0 })
  })

  it('combina línea, destacados, ids, orden A-Z y paginación', async () => {
    const list = get(ListProductsQuery)
    const all = await list.execute({ sort: 'destacados', page: 1, pageSize: 100 })
    const torpedos = await list.execute({
      category: 'torpedos',
      sort: 'az',
      page: 1,
      pageSize: 100,
    })
    const featured = await list.execute({
      featured: true,
      sort: 'destacados',
      page: 1,
      pageSize: 2,
    })
    const [first, second] = all.items
    const byIds = await list.execute({
      ids: [second?.id ?? '', first?.id ?? '', 'prd-no-es-uuid'],
      sort: 'destacados',
      page: 1,
      pageSize: 100,
    })
    const onlyInvalid = await list.execute({
      ids: ['prd-galleta'],
      sort: 'destacados',
      page: 1,
      pageSize: 100,
    })

    const farPage = await list.execute({
      sort: 'destacados',
      page: 2_000_000_000,
      pageSize: 24,
    })

    expect(farPage).toMatchObject({ items: [], page: 2_000_000_000, total: 27 })
    expect(all.total).toBe(27)
    expect(all.items.slice(0, 8).every(({ featured: isFeatured }) => isFeatured)).toBe(true)
    const names = torpedos.items.map(({ name }) => name)
    expect(names).toEqual(names.toSorted(new Intl.Collator('es').compare))
    expect(featured).toMatchObject({ pageSize: 2, total: 8 })
    expect(featured.items).toHaveLength(2)
    expect(byIds.items.map(({ id }) => id)).toEqual([first?.id, second?.id])
    expect(onlyInvalid).toMatchObject({ items: [], total: 0 })
  })

  it('resuelve un slug anterior y devuelve el producto con su slug actual', async () => {
    const prisma = get(PrismaService)
    const product = await prisma.product.findUniqueOrThrow({ where: { slug: 'mate-galleta' } })
    await prisma.productSlugHistory.create({
      data: { slug: 'mate-galleta-viejo', productId: product.id },
    })

    const detail = await get(GetProductQuery).execute('mate-galleta-viejo')

    expect(detail).toMatchObject({ slug: 'mate-galleta', isSoldOut: true, isPurchasable: false })
    await expect(get(GetProductQuery).execute('no-existe')).resolves.toBeNull()
  })

  it('devuelve hasta 4 relacionados: primero la misma línea, después el mismo grupo', async () => {
    const related = await get(GetRelatedProductsQuery).execute('mate-imperial-premium')

    expect(related?.map(({ slug }) => slug)).toEqual([
      'mate-imperial-de-calabaza',
      'mate-imperial-termico',
      'mate-imperial-criollo',
      'mate-torpedo-premium',
    ])
  })

  it('lista las 6 líneas por posición con sus productos publicados', async () => {
    const categories = await get(ListCategoriesQuery).execute()

    expect(categories).toHaveLength(6)
    expect(categories.map(({ position }) => position)).toEqual([1, 2, 3, 4, 5, 6])
    expect(categories.reduce((total, { productCount }) => total + productCount, 0)).toBe(27)
    expect(categories[0]?.image?.publicId).toBe('galpon/productos/mate-imperial-premium')
  })

  it('lee reseñas aprobadas con estadísticas y las 5 destacadas', async () => {
    const page = await get(ListProductReviewsQuery).execute('mate-imperial-premium', 1)
    const featured = await get(ListFeaturedReviewsQuery).execute()

    expect(page).toMatchObject({ page: 1, pageSize: 10, total: 3, stats: { count: 3 } })
    expect(page?.items.every(({ verifiedPurchase }) => verifiedPurchase)).toBe(true)
    expect(page?.stats.distribution[0]).toEqual({ stars: 5, count: 2, percent: 67 })
    expect(featured).toHaveLength(5)
    const dates = featured.map(({ createdAt }) => createdAt)
    expect(dates).toEqual(dates.toSorted().reverse())
    await expect(get(ListProductReviewsQuery).execute('no-existe', 1)).resolves.toBeNull()
  })

  it('lee contenidos y ajustes públicos', async () => {
    const home = await get(GetContentQuery).execute('home')
    const terms = await get(GetContentQuery).execute('legal-terms')
    const settings = await get(GetPublicSettingsQuery).execute()

    expect(home?.scenes).toHaveLength(6)
    expect(terms?.title).toBe('Términos y condiciones')
    expect(settings.kitDiscountPercent).toBe(10)
    expect(settings.shippingOptions.map(({ method }) => method)).toEqual([
      'home',
      'branch',
      'pickup',
    ])
    expect(settings).not.toHaveProperty('vatRatePercent')
  })

  it('con Redis caído responde lo mismo desde Postgres (la caché falla abierta)', async () => {
    const before = {
      mates: await get(ListProductsQuery).execute(MATES_BY_PRICE),
      premium: await get(GetProductQuery).execute('mate-imperial-premium'),
    }
    cache().disconnect()
    await containers?.stopRedis()

    const mates = await get(ListProductsQuery).execute(MATES_BY_PRICE)
    const premium = await get(GetProductQuery).execute('mate-imperial-premium')
    const yerbas = await get(ListProductsQuery).execute({
      group: 'yerba',
      sort: 'mayor',
      page: 1,
      pageSize: 10,
    })

    expect(mates).toEqual(before.mates)
    expect(premium).toEqual(before.premium)
    expect(yerbas.total).toBe(3)
    await expect(get(ListCategoriesQuery).execute()).resolves.toHaveLength(6)
    await expect(get(GetPublicSettingsQuery).execute()).resolves.toMatchObject({
      kitDiscountPercent: 10,
    })
    await expect(get(GetContentQuery).execute('footer')).resolves.not.toBeNull()
  })
})
