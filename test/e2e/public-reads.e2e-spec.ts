import type { INestApplication } from '@nestjs/common'
import type { Server } from 'node:http'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { seed } from '../../prisma/seed'
import type { ProductDetail, ProductPage } from '../../src/modules/catalog/application/read-models'
import type { HomeContent, LegalContent } from '../../src/modules/content/application/read-models'
import type { ReviewPage } from '../../src/modules/reviews/application/read-models'
import type { PublicSettings } from '../../src/modules/settings/application/read-models'
import { PrismaService } from '../../src/shared/infrastructure/prisma/prisma.service'
import { createApp } from '../support/app'
import { startContainers, type TestContainers } from '../support/containers'

/** Producto de referencia del diseño. */
const PREMIUM = 'mate-imperial-premium'

/** Primer error por campo de una respuesta 422 (`errors[0]` del `Problem`). */
function firstError(response: { body: unknown }): unknown {
  const { errors } = response.body as { errors?: unknown[] }
  return errors?.[0]
}

describe('lecturas públicas del contrato (HTTP + Postgres + Redis)', () => {
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

  function server(): Server {
    if (app === undefined) throw new Error('La app no arrancó')
    return app.getHttpServer()
  }

  function prisma(): PrismaService {
    if (app === undefined) throw new Error('La app no arrancó')
    return app.get(PrismaService)
  }

  it('GET /categories → 6 líneas ordenadas por position', async () => {
    const response = await request(server()).get('/api/v1/categories')

    expect(response.status).toBe(200)
    expect(response.body).toHaveLength(6)
    const positions = (response.body as { position: number }[]).map(({ position }) => position)
    expect(positions).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('GET /products?pageSize=100 → los 27 productos publicados', async () => {
    const response = await request(server()).get('/api/v1/products?pageSize=100')

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ page: 1, pageSize: 100, total: 27 })
    expect((response.body as ProductPage).items).toHaveLength(27)
  })

  it('GET /products?category=imperiales&sort=menor → solo imperiales, por precio ascendente', async () => {
    const response = await request(server()).get(
      '/api/v1/products?category=imperiales&sort=menor&pageSize=100',
    )

    expect(response.status).toBe(200)
    const { items } = response.body as ProductPage
    expect(items.length).toBeGreaterThan(0)
    expect(items.every(({ categorySlug }) => categorySlug === 'imperiales')).toBe(true)
    const prices = items.map(({ priceArs }) => priceArs).filter((price) => price !== null)
    expect(prices).toEqual(prices.toSorted((a, b) => a - b))
  })

  it('GET /products?pageSize=1000 → 422 problem+json con el error en pageSize (nunca 500)', async () => {
    const response = await request(server()).get('/api/v1/products?pageSize=1000')

    expect(response.status).toBe(422)
    expect(response.headers['content-type']).toContain('application/problem+json')
    expect(response.body).toMatchObject({ type: 'validation_error', status: 422 })
    expect(firstError(response)).toMatchObject({ field: 'pageSize' })
  })

  it('GET /products?page=0 → 422 con el error en page', async () => {
    const response = await request(server()).get('/api/v1/products?page=0')

    expect(response.status).toBe(422)
    expect(firstError(response)).toMatchObject({ field: 'page' })
  })

  it('GET /products/mate-imperial-premium → ficha con código N°01, 2 fotos y rating', async () => {
    const response = await request(server()).get(`/api/v1/products/${PREMIUM}`)

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ slug: PREMIUM, code: 'N°01' })
    const product = response.body as ProductDetail
    expect(product.images).toHaveLength(2)
    expect(product.rating).toMatchObject({ count: 3 })
  })

  it('GET /products/no-existe → 404 problem+json', async () => {
    const response = await request(server()).get('/api/v1/products/no-existe')

    expect(response.status).toBe(404)
    expect(response.headers['content-type']).toContain('application/problem+json')
    expect(response.body).toMatchObject({ type: 'not_found', status: 404 })
  })

  it('un slug de product_slug_history → 200 con el producto y su slug actual', async () => {
    const product = await prisma().product.findUniqueOrThrow({ where: { slug: PREMIUM } })
    await prisma().productSlugHistory.create({
      data: { slug: 'mate-imperial-premium-viejo', productId: product.id },
    })

    const response = await request(server()).get('/api/v1/products/mate-imperial-premium-viejo')

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ id: product.id, slug: PREMIUM })
  })

  it('GET /products/{slug}/related → hasta 4, misma línea primero y después el mismo grupo', async () => {
    const response = await request(server()).get(`/api/v1/products/${PREMIUM}/related`)

    expect(response.status).toBe(200)
    expect((response.body as { slug: string }[]).map(({ slug }) => slug)).toEqual([
      'mate-imperial-de-calabaza',
      'mate-imperial-termico',
      'mate-imperial-criollo',
      'mate-torpedo-premium',
    ])
  })

  it('GET /products/{slug}/reviews → página con stats, solo las aprobadas', async () => {
    const product = await prisma().product.findUniqueOrThrow({ where: { slug: PREMIUM } })
    await prisma().review.create({
      data: { productId: product.id, authorName: 'Pendiente', rating: 1, text: 'Sin moderar.' },
    })

    const response = await request(server()).get(`/api/v1/products/${PREMIUM}/reviews`)

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ page: 1, pageSize: 10, total: 3, stats: { count: 3 } })
    const authors = (response.body as ReviewPage).items.map(({ authorName }) => authorName)
    expect(authors).toHaveLength(3)
    expect(authors).not.toContain('Pendiente')
  })

  it('GET /reviews/featured → las 5 destacadas', async () => {
    const response = await request(server()).get('/api/v1/reviews/featured')

    expect(response.status).toBe(200)
    expect(response.body).toHaveLength(5)
  })

  it('GET /content/home → la forma HomeContent', async () => {
    const response = await request(server()).get('/api/v1/content/home')

    expect(response.status).toBe(200)
    expect(Object.keys(response.body as object).sort()).toEqual(
      [
        'collection',
        'featured',
        'hero',
        'kitBlock',
        'manifesto',
        'reviews',
        'ritualSteps',
        'scenes',
        'stats',
        'storyProducts',
      ].sort(),
    )
    expect((response.body as HomeContent).scenes).toHaveLength(6)
  })

  it.each(['about', 'faq', 'footer', 'product-tabs'])('GET /content/%s → 200', async (page) => {
    const response = await request(server()).get(`/api/v1/content/${page}`)

    expect(response.status).toBe(200)
  })

  it('GET /content/legal/terms y /privacy → 200; /content/legal/otro → 404 (contrato)', async () => {
    const terms = await request(server()).get('/api/v1/content/legal/terms')
    const privacy = await request(server()).get('/api/v1/content/legal/privacy')
    const other = await request(server()).get('/api/v1/content/legal/otro')

    expect(terms.status).toBe(200)
    expect((terms.body as LegalContent).title).toBe('Términos y condiciones')
    expect(privacy.status).toBe(200)
    expect(other.status).toBe(404)
    expect(other.headers['content-type']).toContain('application/problem+json')
    expect(other.body).toMatchObject({ type: 'not_found' })
  })

  it('GET /settings/public → kitDiscountPercent 10, sin datos internos', async () => {
    const response = await request(server()).get('/api/v1/settings/public')

    expect(response.status).toBe(200)
    expect((response.body as PublicSettings).kitDiscountPercent).toBe(10)
    expect(response.body).not.toHaveProperty('vatRatePercent')
  })
})
