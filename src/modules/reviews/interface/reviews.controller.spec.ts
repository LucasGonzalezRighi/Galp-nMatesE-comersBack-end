import type { INestApplication } from '@nestjs/common'
import type { Server } from 'node:http'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { createControllerApp } from '../../../../test/support/controller-app'
import { SubmitReviewCommand } from '../application/commands/submit-review.command'
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
  const submitReview = {
    execute: vi.fn((slug: string) =>
      Promise.resolve(slug === KNOWN_SLUG ? { status: 'pending' as const } : null),
    ),
  }
  let app: INestApplication<Server> | undefined

  beforeAll(async () => {
    app = await createControllerApp({
      controllers: [ReviewsController],
      providers: [
        { provide: ListProductReviewsQuery, useValue: listProductReviews },
        { provide: ListFeaturedReviewsQuery, useValue: listFeaturedReviews },
        { provide: SubmitReviewCommand, useValue: submitReview },
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

  describe('POST /products/{slug}/reviews', () => {
    const body = {
      rating: 4.5,
      authorName: '  ',
      text: '  Un mate hermoso, llegó rápido.  ',
      website: null,
    }

    it('responde 202 { status: pending } con el cuerpo normalizado (nombre vacío en null)', async () => {
      const response = await request(server()).post(`/products/${KNOWN_SLUG}/reviews`).send(body)

      expect(response.status).toBe(202)
      expect(response.body).toEqual({ status: 'pending' })
      expect(submitReview.execute.mock.calls).toEqual([
        [
          KNOWN_SLUG,
          { rating: 4.5, authorName: null, text: 'Un mate hermoso, llegó rápido.', website: null },
        ],
      ])
    })

    it('un producto que no existe da 404 "No existe un producto con ese slug."', async () => {
      const response = await request(server()).post('/products/no-existe/reviews').send(body)

      expect(response.status).toBe(404)
      expect(response.body).toMatchObject({ detail: 'No existe un producto con ese slug.' })
    })

    it('el pipe valida antes: trampa llena con otro campo inválido → 422 sin llamar al caso de uso', async () => {
      const response = await request(server())
        .post('/products/no-existe/reviews')
        .send({ ...body, rating: 4.3, website: 'spam' })

      expect(response.status).toBe(422)
      expect(firstError(response)).toMatchObject({
        field: 'rating',
        message: 'Elegí una puntuación de 1 a 5 estrellas.',
      })
      expect(submitReview.execute).not.toHaveBeenCalled()
    })

    it('el contrato pide los campos nullable: sin authorName ni website → 422 "Requerido"', async () => {
      const response = await request(server())
        .post(`/products/${KNOWN_SLUG}/reviews`)
        .send({ rating: 5, text: 'Un mate hermoso, llegó rápido.' })

      const { errors } = response.body as { errors: { field: string }[] }
      const first = (field: string): unknown => errors.find((error) => error.field === field)
      expect(response.status).toBe(422)
      expect(first('authorName')).toEqual({
        field: 'authorName',
        code: 'required',
        message: 'Requerido',
      })
      expect(first('website')).toEqual({ field: 'website', code: 'required', message: 'Requerido' })
    })
  })

  it('devuelve las destacadas', async () => {
    const response = await request(server()).get('/reviews/featured')

    expect(response.status).toBe(200)
    expect(response.body).toEqual([])
    expect(listFeaturedReviews.execute).toHaveBeenCalledOnce()
  })
})
