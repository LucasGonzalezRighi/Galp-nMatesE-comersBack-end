import { Controller, Get, type INestApplication } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler'
import type { Server } from 'node:http'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createControllerApp } from '../../../../test/support/controller-app'
import { GetProductQuery } from '../../../modules/catalog/application/queries/get-product.query'
import { GetRelatedProductsQuery } from '../../../modules/catalog/application/queries/get-related-products.query'
import { ListCategoriesQuery } from '../../../modules/catalog/application/queries/list-categories.query'
import { ListProductsQuery } from '../../../modules/catalog/application/queries/list-products.query'
import { CategoriesController } from '../../../modules/catalog/interface/categories.controller'
import { ProductsController } from '../../../modules/catalog/interface/products.controller'
import { GetContentQuery } from '../../../modules/content/application/queries/get-content.query'
import { ContentController } from '../../../modules/content/interface/content.controller'
import { ListFeaturedReviewsQuery } from '../../../modules/reviews/application/queries/list-featured-reviews.query'
import { ListProductReviewsQuery } from '../../../modules/reviews/application/queries/list-product-reviews.query'
import { ReviewsController } from '../../../modules/reviews/interface/reviews.controller'
import { GetPublicSettingsQuery } from '../../../modules/settings/application/queries/get-public-settings.query'
import { SettingsController } from '../../../modules/settings/interface/settings.controller'

/** Límite de la app de prueba: chico para no hacer cientos de pedidos (en producción son 120). */
const TEST_LIMIT = 2

/** Pedidos por ruta: más que {@link TEST_LIMIT}, así un límite activo se nota. */
const REQUESTS_PER_ROUTE = TEST_LIMIT + 3

/** Las 13 lecturas públicas del contrato (con slugs y documentos válidos). */
const PUBLIC_READ_PATHS = [
  '/categories',
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

describe('Lecturas públicas fuera del límite global de pedidos por IP (spec §3.2)', () => {
  let app: INestApplication<Server> | undefined

  beforeAll(async () => {
    app = await createControllerApp({
      imports: [ThrottlerModule.forRoot({ throttlers: [{ ttl: 60_000, limit: TEST_LIMIT }] })],
      controllers: [
        CategoriesController,
        ProductsController,
        ContentController,
        ReviewsController,
        SettingsController,
        LimitedControlController,
      ],
      providers: [
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: ListCategoriesQuery, useValue: inMemoryQuery },
        { provide: ListProductsQuery, useValue: inMemoryQuery },
        { provide: GetProductQuery, useValue: inMemoryQuery },
        { provide: GetRelatedProductsQuery, useValue: inMemoryQuery },
        { provide: GetContentQuery, useValue: inMemoryQuery },
        { provide: ListProductReviewsQuery, useValue: inMemoryQuery },
        { provide: ListFeaturedReviewsQuery, useValue: inMemoryQuery },
        { provide: GetPublicSettingsQuery, useValue: inMemoryQuery },
      ],
    })
  })

  afterAll(async () => {
    await app?.close()
  })

  function server(): Server {
    if (app === undefined) throw new Error('La app no arrancó')
    return app.getHttpServer()
  }

  it('control: una ruta sin @SkipThrottle responde 429 al pasar el límite', async () => {
    const statuses: number[] = []
    for (let i = 0; i < REQUESTS_PER_ROUTE; i += 1) {
      statuses.push((await request(server()).get('/limited-control')).status)
    }

    expect(statuses).toEqual([200, 200, 429, 429, 429])
  })

  it.each(PUBLIC_READ_PATHS)('GET %s responde 200 siempre, sin 429', async (path) => {
    const statuses: number[] = []
    for (let i = 0; i < REQUESTS_PER_ROUTE; i += 1) {
      statuses.push((await request(server()).get(path)).status)
    }

    expect(statuses).toEqual(Array<number>(REQUESTS_PER_ROUTE).fill(200))
  })
})
