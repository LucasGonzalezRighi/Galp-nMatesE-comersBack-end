import type { INestApplication } from '@nestjs/common'
import type { Server } from 'node:http'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { createControllerApp } from '../../../../test/support/controller-app'
import type { ProductFilter } from '../application/ports/product.repository.port'
import { GetProductQuery } from '../application/queries/get-product.query'
import { GetRelatedProductsQuery } from '../application/queries/get-related-products.query'
import { ListProductsQuery } from '../application/queries/list-products.query'
import type { ProductPage } from '../application/read-models'
import { ProductsController } from './products.controller'

/** Única ficha que conocen las queries en memoria. */
const KNOWN_SLUG = 'mate-imperial-premium'

/** Primer error por campo de una respuesta 422 (`errors[0]` del `Problem`). */
function firstError(response: { body: unknown }): unknown {
  const { errors } = response.body as { errors?: unknown[] }
  return errors?.[0]
}

describe('ProductsController (HTTP con queries en memoria)', () => {
  const listProducts = {
    execute: vi.fn((filter: ProductFilter): Promise<ProductPage> =>
      Promise.resolve({ items: [], page: filter.page, pageSize: filter.pageSize, total: 0 }),
    ),
  }
  const getProduct = {
    execute: vi.fn((slug: string) => Promise.resolve(slug === KNOWN_SLUG ? { slug } : null)),
  }
  const getRelatedProducts = {
    execute: vi.fn((slug: string) => Promise.resolve(slug === KNOWN_SLUG ? [] : null)),
  }
  let app: INestApplication<Server> | undefined

  beforeAll(async () => {
    app = await createControllerApp({
      controllers: [ProductsController],
      providers: [
        { provide: ListProductsQuery, useValue: listProducts },
        { provide: GetProductQuery, useValue: getProduct },
        { provide: GetRelatedProductsQuery, useValue: getRelatedProducts },
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

  it('sin parámetros pide la primera página de 24 por destacados', async () => {
    const response = await request(server()).get('/products')

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ items: [], page: 1, pageSize: 24, total: 0 })
    expect(listProducts.execute).toHaveBeenCalledWith({
      category: undefined,
      group: undefined,
      ids: undefined,
      q: undefined,
      sort: 'destacados',
      featured: undefined,
      page: 1,
      pageSize: 24,
    })
  })

  it('pasa los filtros convertidos, con featured=false como false', async () => {
    const response = await request(server()).get('/products').query({
      category: 'imperiales',
      group: 'mate',
      ids: 'a,b',
      q: 'bombillón',
      sort: 'menor',
      featured: 'false',
      page: '2',
      pageSize: '10',
    })

    expect(response.status).toBe(200)
    expect(listProducts.execute).toHaveBeenCalledWith({
      category: 'imperiales',
      group: 'mate',
      ids: ['a', 'b'],
      q: 'bombillón',
      sort: 'menor',
      featured: false,
      page: 2,
      pageSize: 10,
    })
  })

  it.each([
    ['pageSize=1000', 'pageSize', 'too_big'],
    ['page=0', 'page', 'too_small'],
    ['page=abc', 'page', 'invalid_type'],
    ['page=9007199254740993', 'page', 'too_big'],
    ['sort=precio', 'sort', 'invalid_value'],
    ['group=termo', 'group', 'invalid_value'],
    ['featured=si', 'featured', 'invalid_type'],
    ['category=Mates!', 'category', 'invalid_format'],
    [`q=${'a'.repeat(101)}`, 'q', 'too_big'],
    ['ids=', 'ids', 'too_small'],
    ['color=rojo', 'color', 'unrecognized_key'],
  ])('?%s → 422 problem+json con el error en %s (%s)', async (query, field, code) => {
    const response = await request(server()).get(`/products?${query}`)

    expect(response.status).toBe(422)
    expect(response.headers['content-type']).toContain('application/problem+json')
    expect(response.body).toMatchObject({ type: 'validation_error', status: 422 })
    expect(firstError(response)).toMatchObject({ field, code })
    expect(listProducts.execute).not.toHaveBeenCalled()
  })

  it('devuelve la ficha y 404 problem+json si el producto no existe', async () => {
    const found = await request(server()).get(`/products/${KNOWN_SLUG}`)
    const missing = await request(server()).get('/products/no-existe')

    expect(found.status).toBe(200)
    expect(found.body).toEqual({ slug: KNOWN_SLUG })
    expect(missing.status).toBe(404)
    expect(missing.headers['content-type']).toContain('application/problem+json')
    expect(missing.body).toMatchObject({
      type: 'not_found',
      status: 404,
      detail: 'No existe un producto con ese slug.',
    })
  })

  it.each(['/products/Mate_Imperial', '/products/Mate_Imperial/related'])(
    '%s → 422 con el error en slug (invalid_format)',
    async (path) => {
      const response = await request(server()).get(path)

      expect(response.status).toBe(422)
      expect(firstError(response)).toMatchObject({ field: 'slug', code: 'invalid_format' })
      expect(getProduct.execute).not.toHaveBeenCalled()
      expect(getRelatedProducts.execute).not.toHaveBeenCalled()
    },
  )

  it('devuelve los relacionados y 404 si el producto no existe', async () => {
    const found = await request(server()).get(`/products/${KNOWN_SLUG}/related`)
    const missing = await request(server()).get('/products/no-existe/related')

    expect(found.status).toBe(200)
    expect(found.body).toEqual([])
    expect(missing.status).toBe(404)
    expect(missing.body).toMatchObject({ type: 'not_found' })
  })
})
