import { describe, expect, it } from 'vitest'

import type { ProductReview } from '../../domain/review.entity'
import type { ProductLookupPort } from '../ports/product-lookup.port'
import type { FeaturedProductReview, ReviewRepository } from '../ports/review.repository.port'
import { ListFeaturedReviewsQuery } from './list-featured-reviews.query'
import { REVIEWS_PAGE_SIZE, ListProductReviewsQuery } from './list-product-reviews.query'

/** Reseña aprobada del producto `p1`, del día `day` de octubre. */
function review(id: string, rating: number, day: number): ProductReview {
  return {
    id,
    productId: 'p1',
    authorName: `Autor ${id}`,
    rating,
    text: 'Muy bueno.',
    createdAt: new Date(Date.UTC(2026, 9, day)),
    verifiedPurchase: true,
  }
}

/** Repositorio en memoria: devuelve las reseñas tal cual (el orden es responsabilidad suya). */
function repository(
  approved: readonly ProductReview[],
  featured: readonly FeaturedProductReview[] = [],
): ReviewRepository {
  return {
    listApprovedByProduct: (productId) =>
      Promise.resolve(approved.filter((item) => item.productId === productId)),
    listFeatured: () => Promise.resolve([...featured]),
  }
}

const lookup: ProductLookupPort = {
  findPublishedIdBySlug: (slug) =>
    Promise.resolve(slug === 'mate-imperial-premium' || slug === 'slug-viejo' ? 'p1' : null),
}

describe('ListProductReviewsQuery', () => {
  it('pagina de a 10 y calcula las estadísticas con todas las aprobadas', async () => {
    const approved = Array.from({ length: 12 }, (_, index) =>
      review(`r${String(index)}`, index === 0 ? 4.5 : 5, 20 - index),
    )
    const query = new ListProductReviewsQuery(repository(approved), lookup)

    const first = await query.execute('mate-imperial-premium', 1)
    const second = await query.execute('slug-viejo', 2)

    expect(first?.items).toHaveLength(REVIEWS_PAGE_SIZE)
    expect(first?.items[0]).toEqual({
      id: 'r0',
      authorName: 'Autor r0',
      rating: 4.5,
      text: 'Muy bueno.',
      createdAt: '2026-10-20T00:00:00.000Z',
      verifiedPurchase: true,
    })
    expect(second).toMatchObject({ page: 2, pageSize: 10, total: 12 })
    expect(second?.items.map(({ id }) => id)).toEqual(['r10', 'r11'])
    expect(second?.stats).toEqual({
      average: (4.5 + 11 * 5) / 12,
      count: 12,
      distribution: [
        { stars: 5, count: 11, percent: 92 },
        { stars: 4, count: 1, percent: 8 },
        { stars: 3, count: 0, percent: 0 },
        { stars: 2, count: 0, percent: 0 },
        { stars: 1, count: 0, percent: 0 },
      ],
    })
  })

  it('sin reseñas devuelve promedio 0 y la página vacía', async () => {
    const page = await new ListProductReviewsQuery(repository([]), lookup).execute(
      'mate-imperial-premium',
      1,
    )
    expect(page).toMatchObject({ items: [], total: 0, stats: { average: 0, count: 0 } })
  })

  it('devuelve null si el producto no existe y valida la página', async () => {
    const query = new ListProductReviewsQuery(repository([]), lookup)
    await expect(query.execute('no-existe', 1)).resolves.toBeNull()
    await expect(query.execute('mate-imperial-premium', 0)).rejects.toThrow(/página/)
  })
})

describe('ListFeaturedReviewsQuery', () => {
  it('devuelve las destacadas con su producto, de la más nueva a la más vieja', async () => {
    const featured: FeaturedProductReview[] = [
      { review: review('viejo', 5, 1), product: { slug: 'a', name: 'A' } },
      { review: review('nuevo', 4, 9), product: { slug: 'b', name: 'B' } },
    ]
    const items = await new ListFeaturedReviewsQuery(repository([], featured)).execute()

    expect(items.map(({ id }) => id)).toEqual(['nuevo', 'viejo'])
    expect(items[0]).toEqual({
      id: 'nuevo',
      authorName: 'Autor nuevo',
      rating: 4,
      text: 'Muy bueno.',
      createdAt: '2026-10-09T00:00:00.000Z',
      verifiedPurchase: true,
      product: { slug: 'b', name: 'B' },
    })
  })
})
