import { describe, expect, it, vi } from 'vitest'

import type { CachePort } from '../../../shared/application/ports/cache.port'
import {
  CATALOG_CACHE_TTL_SECONDS,
  bumpCatalogCacheVersion,
} from '../../catalog/infrastructure/catalog-cache'
import type { ReviewRepository } from '../application/ports/review.repository.port'
import type { ProductReview } from '../domain/review.entity'
import { CachedReviewRepository } from './cached-review.repository'

const REVIEW: ProductReview = {
  id: 'r1',
  productId: 'p1',
  authorName: 'Lucía F.',
  rating: 4.5,
  text: 'Hermoso, ideal para la ronda larga.',
  createdAt: new Date('2026-07-15T15:00:00.000Z'),
  verifiedPurchase: true,
}

/** Caché en memoria que guarda como JSON (igual que Redis) y anota cada `set`. */
function memoryCache() {
  const store = new Map<string, unknown>()
  const set = vi.fn<CachePort['set']>((key, value) => {
    store.set(key, JSON.parse(JSON.stringify(value)))
    return Promise.resolve()
  })
  const cache: CachePort = {
    get: <T>(key: string) => Promise.resolve((store.get(key) ?? null) as T | null),
    set,
    del: () => Promise.resolve(),
    incr: (key) => {
      const next = Number(store.get(key) ?? 0) + 1
      store.set(key, next)
      return Promise.resolve(next)
    },
  }
  return { cache, set }
}

function innerRepository() {
  return {
    listApprovedByProduct: vi.fn<ReviewRepository['listApprovedByProduct']>(() =>
      Promise.resolve([REVIEW]),
    ),
    listFeatured: vi.fn<ReviewRepository['listFeatured']>(() =>
      Promise.resolve([
        { review: REVIEW, product: { slug: 'mate-imperial-premium', name: 'Mate Imperial' } },
      ]),
    ),
  } satisfies ReviewRepository
}

describe('CachedReviewRepository (NV-22)', () => {
  it('las aprobadas de un producto se leen de Postgres una vez por versión y vuelven con su fecha', async () => {
    const inner = innerRepository()
    const { cache, set } = memoryCache()
    const repository = new CachedReviewRepository(inner, cache)

    await repository.listApprovedByProduct('p1')
    const cached = await repository.listApprovedByProduct('p1')

    expect(inner.listApprovedByProduct).toHaveBeenCalledTimes(1)
    expect(cached).toEqual([REVIEW])
    expect(cached[0]?.createdAt).toBeInstanceOf(Date)
    expect(set).toHaveBeenCalledWith(
      'catalog:v0:reviews:product:p1',
      expect.anything(),
      CATALOG_CACHE_TTL_SECONDS,
    )
  })

  it('las destacadas también se cachean, en una sola clave', async () => {
    const inner = innerRepository()
    const { cache, set } = memoryCache()
    const repository = new CachedReviewRepository(inner, cache)

    await repository.listFeatured()
    const cached = await repository.listFeatured()

    expect(inner.listFeatured).toHaveBeenCalledTimes(1)
    expect(cached).toEqual([
      { review: REVIEW, product: { slug: 'mate-imperial-premium', name: 'Mate Imperial' } },
    ])
    expect(set.mock.calls.map(([key]) => key)).toEqual(['catalog:v0:reviews:featured'])
  })

  it('la moderación sube la versión del catálogo: la lectura siguiente vuelve a Postgres', async () => {
    const inner = innerRepository()
    const { cache } = memoryCache()
    const repository = new CachedReviewRepository(inner, cache)

    await repository.listApprovedByProduct('p1')
    await repository.listFeatured()
    await bumpCatalogCacheVersion(cache)
    await repository.listApprovedByProduct('p1')
    await repository.listFeatured()

    expect(inner.listApprovedByProduct).toHaveBeenCalledTimes(2)
    expect(inner.listFeatured).toHaveBeenCalledTimes(2)
  })
})
