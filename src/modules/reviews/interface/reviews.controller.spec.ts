import type { INestApplication } from '@nestjs/common'
import type { Server } from 'node:http'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { createControllerApp } from '../../../../test/support/controller-app'
import { ListFeaturedReviewsQuery } from '../application/queries/list-featured-reviews.query'
import { ListProductReviewsQuery } from '../application/queries/list-product-reviews.query'
import { ReviewsController } from './reviews.controller'

/** Único producto que conoce la query en memoria. */
const KNOWN_SLUG = 'mate-imperial-premium'

/** Primer error por campo de una respuesta 422 (`errors[0]` del `Problem`). */
function firstError(response: { body: unknown }): unknown {
  const { errors } = response.body as { errors?: unknown[] }
  return errors?.[0]
}

describe('ReviewsController (HTTP con queries en memoria)', () => {
  const listProductReviews = {
    execute: vi.fn((slug: string, page: number) =>
      Promise.resolve(slug === KNOWN_SLUG ? { items: [], page, pageSize: 10, total: 0 } : null),
    ),
  }
  const listFeaturedReviews = { execute: vi.fn(() => Promise.resolve([])) }
  let app: INestApplication<Server> | undefined

  beforeAll(async () => {
    app = await createControllerApp({
      controllers: [ReviewsController],
      providers: [
        { provide: ListProductReviewsQuery, useValue: listProductReviews },
        { provide: ListFeaturedReviewsQuery, useValue: listFeaturedReviews },
      ],
    })
  })

  afterAll(async () => {
    await app?.close()
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  function server(): Server {
    if (app === undefined) throw new Error('La app no arrancó')
    return app.getHttpServer()
  }

  it('pide la página 1 por defecto y la pedida si viene', async () => {
    const first = await request(server()).get(`/products/${KNOWN_SLUG}/reviews`)
    const third = await request(server()).get(`/products/${KNOWN_SLUG}/reviews?page=3`)

    expect(first.status).toBe(200)
    expect(third.status).toBe(200)
    expect(listProductReviews.execute.mock.calls).toEqual([
      [KNOWN_SLUG, 1],
      [KNOWN_SLUG, 3],
    ])
  })

  it.each([
    ['page=0', 'page', 'too_small'],
    ['pageSize=10', 'pageSize', 'unrecognized_key'],
  ])('?%s → 422 con el error en %s (%s)', async (query, field, code) => {
    const response = await request(server()).get(`/products/${KNOWN_SLUG}/reviews?${query}`)

    expect(response.status).toBe(422)
    expect(firstError(response)).toMatchObject({ field, code })
    expect(listProductReviews.execute).not.toHaveBeenCalled()
  })

  it('responde 404 problem+json si el producto no existe y 422 si el slug no sirve', async () => {
    const missing = await request(server()).get('/products/no-existe/reviews')
    const invalid = await request(server()).get('/products/NO_EXISTE/reviews')

    expect(missing.status).toBe(404)
    expect(missing.headers['content-type']).toContain('application/problem+json')
    expect(missing.body).toMatchObject({ type: 'not_found' })
    expect(invalid.status).toBe(422)
    expect(firstError(invalid)).toMatchObject({ field: 'slug' })
  })

  it('devuelve las destacadas', async () => {
    const response = await request(server()).get('/reviews/featured')

    expect(response.status).toBe(200)
    expect(response.body).toEqual([])
    expect(listFeaturedReviews.execute).toHaveBeenCalledOnce()
  })
})
