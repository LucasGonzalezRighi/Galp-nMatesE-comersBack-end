import { Controller, Get } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { Test } from '@nestjs/testing'
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { GetProductQuery } from '../../../modules/catalog/application/queries/get-product.query'
import { GetRelatedProductsQuery } from '../../../modules/catalog/application/queries/get-related-products.query'
import { ListCategoriesQuery } from '../../../modules/catalog/application/queries/list-categories.query'
import { ListCombosQuery } from '../../../modules/catalog/application/queries/list-combos.query'
import { ListProductsQuery } from '../../../modules/catalog/application/queries/list-products.query'
import { CategoriesController } from '../../../modules/catalog/interface/categories.controller'
import { CombosController } from '../../../modules/catalog/interface/combos.controller'
import { ProductsController } from '../../../modules/catalog/interface/products.controller'
import { GetContentQuery } from '../../../modules/content/application/queries/get-content.query'
import { ContentController } from '../../../modules/content/interface/content.controller'
import { SubmitReviewCommand } from '../../../modules/reviews/application/commands/submit-review.command'
import { ListFeaturedReviewsQuery } from '../../../modules/reviews/application/queries/list-featured-reviews.query'
import { ListProductReviewsQuery } from '../../../modules/reviews/application/queries/list-product-reviews.query'
import { ReviewsController } from '../../../modules/reviews/interface/reviews.controller'
import { GetPublicSettingsQuery } from '../../../modules/settings/application/queries/get-public-settings.query'
import { SettingsController } from '../../../modules/settings/interface/settings.controller'
import { applyTrustProxy } from '../http/client-ip'
import { ProblemFilter } from '../http/problem.filter'
import { createValidationPipe } from '../http/validation.pipe'
import { skipWithoutKnownClientIp } from './client-rate-limit'
import { PUBLIC_READ_RATE_LIMIT } from './public-read'

/** Límite global de la app de prueba: chico (en producción son 120). */
const TEST_LIMIT = 2

/** Pedidos por ruta: más que {@link TEST_LIMIT}, así un límite global activo se nota. */
const REQUESTS_PER_ROUTE = TEST_LIMIT + 3

/** Las 14 lecturas públicas del contrato (con slugs y documentos válidos). */
const PUBLIC_READ_PATHS = [
  '/categories',
  '/combos',
  '/products',
  '/products/mate-imperial-premium',
  '/products/mate-imperial-premium/related',
  '/products/mate-imperial-premium/reviews',
  '/reviews/featured',
  '/content/home',
  '/content/about',
  '/content/faq',
  '/content/footer',
  '/content/product-tabs',
  '/content/legal/terms',
  '/settings/public',
] as const

/** Query en memoria: devuelve siempre un objeto, así ninguna ruta termina en 404 ni en 500. */
const inMemoryQuery = { execute: (): Promise<object> => Promise.resolve({}) }

/** Ruta de control con el límite global: prueba que el guard de la app de prueba sí limita. */
@Controller('limited-control')
class LimitedControlController {
  /** @returns Un objeto vacío. */
  @Get()
  read(): object {
    return {}
  }
}

/** Arma la app de prueba con el guard global, el `skipIf` de producción y `trust proxy`. */
async function publicReadsApp(trustProxy: readonly string[]): Promise<NestExpressApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [
      ThrottlerModule.forRoot({
        throttlers: [{ ttl: 60_000, limit: TEST_LIMIT }],
        skipIf: skipWithoutKnownClientIp,
      }),
    ],
    controllers: [
      CategoriesController,
      ProductsController,
      CombosController,
      ContentController,
      ReviewsController,
      SettingsController,
      LimitedControlController,
    ],
    providers: [
      { provide: APP_GUARD, useClass: ThrottlerGuard },
      { provide: ListCategoriesQuery, useValue: inMemoryQuery },
      { provide: ListProductsQuery, useValue: inMemoryQuery },
      { provide: ListCombosQuery, useValue: inMemoryQuery },
      { provide: GetProductQuery, useValue: inMemoryQuery },
      { provide: GetRelatedProductsQuery, useValue: inMemoryQuery },
      { provide: GetContentQuery, useValue: inMemoryQuery },
      { provide: ListProductReviewsQuery, useValue: inMemoryQuery },
      { provide: ListFeaturedReviewsQuery, useValue: inMemoryQuery },
      { provide: SubmitReviewCommand, useValue: inMemoryQuery },
      { provide: GetPublicSettingsQuery, useValue: inMemoryQuery },
    ],
  }).compile()
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false })
  applyTrustProxy(app, trustProxy)
  app.useGlobalFilters(new ProblemFilter())
  app.useGlobalPipes(createValidationPipe())
  await app.init()
  return app
}

describe('Lecturas públicas con su propio límite por IP real (NV-18)', () => {
  let withoutTrust: NestExpressApplication | undefined
  let withTrust: NestExpressApplication | undefined

  beforeAll(async () => {
    withoutTrust = await publicReadsApp([])
    withTrust = await publicReadsApp(['loopback'])
  })

  afterAll(async () => {
    await withoutTrust?.close()
    await withTrust?.close()
  })

  /** Repite `GET path` en la app y devuelve los códigos. */
  async function statusesOf(
    app: NestExpressApplication | undefined,
    path: string,
    times: number,
    forwardedFor?: string,
  ): Promise<number[]> {
    if (app === undefined) throw new Error('La app no arrancó')
    const statuses: number[] = []
    for (let i = 0; i < times; i += 1) {
      const pending = request(app.getHttpServer()).get(path)
      const response =
        forwardedFor === undefined
          ? await pending
          : await pending.set('X-Forwarded-For', forwardedFor)
      statuses.push(response.status)
    }
    return statuses
  }

  it('control: una ruta sin marcar responde 429 al pasar el límite global', async () => {
    const statuses = await statusesOf(
      withTrust,
      '/limited-control',
      REQUESTS_PER_ROUTE,
      '203.0.113.1',
    )

    expect(statuses).toEqual([200, 200, 429, 429, 429])
  })

  it('el POST de reseñas, en el mismo controlador, lleva el límite global (formulario público)', async () => {
    if (withoutTrust === undefined) throw new Error('La app no arrancó')
    const review = {
      rating: 5,
      authorName: null,
      text: 'Un mate hermoso, llegó rápido.',
      website: null,
    }
    const statuses: number[] = []
    for (let i = 0; i < REQUESTS_PER_ROUTE; i += 1) {
      const response = await request(withoutTrust.getHttpServer())
        .post('/products/mate-imperial-premium/reviews')
        .send(review)
      statuses.push(response.status)
    }

    expect(statuses).toEqual([202, 202, 429, 429, 429])
  })

  it.each(PUBLIC_READ_PATHS)(
    'GET %s es lectura pública: a un cliente conocido no le pega el límite global',
    async (path) => {
      const statuses = await statusesOf(withTrust, path, REQUESTS_PER_ROUTE, '203.0.113.2')

      expect(statuses).toEqual(Array<number>(REQUESTS_PER_ROUTE).fill(200))
    },
  )

  it('con TRUST_PROXY, el cliente que pasa el límite de lecturas por minuto recibe 429', async () => {
    const times = PUBLIC_READ_RATE_LIMIT.limit + 1
    const statuses = await statusesOf(withTrust, '/settings/public', times, '203.0.113.3')

    expect(statuses.filter((status) => status === 200)).toHaveLength(PUBLIC_READ_RATE_LIMIT.limit)
    expect(statuses.at(-1)).toBe(429)
  })

  it('el servidor de la tienda (sin X-Forwarded-For) y cualquiera sin TRUST_PROXY no se limitan', async () => {
    const times = PUBLIC_READ_RATE_LIMIT.limit + 1
    const store = await statusesOf(withTrust, '/categories', times)
    const untrusted = await statusesOf(withoutTrust, '/categories', times, '203.0.113.4')

    expect(store).toEqual(Array<number>(times).fill(200))
    expect(untrusted).toEqual(Array<number>(times).fill(200))
  })
})
