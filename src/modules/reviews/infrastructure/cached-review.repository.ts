import { Inject, Injectable } from '@nestjs/common'

import { CACHE_PORT, type CachePort } from '../../../shared/application/ports/cache.port'
import { readThrough } from '../../../shared/application/read-through'
import {
  CATALOG_CACHE_TTL_SECONDS,
  catalogCacheVersion,
  featuredReviewsCacheKey,
  productReviewsCacheKey,
} from '../../catalog/infrastructure/catalog-cache'
import type {
  FeaturedProductReview,
  ReviewRepository,
} from '../application/ports/review.repository.port'
import { createProductReview, type ProductReview } from '../domain/review.entity'
import { PrismaReviewRepository } from './prisma-review.repository'

/** Reseña como queda en la caché: la fecha va como texto ISO 8601. */
interface CachedReview extends Omit<ProductReview, 'createdAt'> {
  createdAt: string
}

/** Destacada como queda en la caché. */
interface CachedFeaturedReview {
  review: CachedReview
  product: { slug: string; name: string }
}

function toCached(review: ProductReview): CachedReview {
  return { ...review, createdAt: review.createdAt.toISOString() }
}

function fromCached(review: CachedReview): ProductReview {
  return createProductReview({ ...review, createdAt: new Date(review.createdAt) })
}

/**
 * Decora las lecturas públicas de reseñas con la caché (NV-22): 60 s, con la versión del catálogo
 * (`catalog:v{n}:reviews:*`), que la moderación sube después de cada cambio. Así cada pedido de la
 * ficha o del inicio ya no lee todas las aprobadas (o todas las destacadas) de Postgres. Las claves
 * van por producto publicado y una para las destacadas: no dependen de lo que mande el cliente.
 * La caché falla abierta: con Redis caído cada lectura va a Postgres.
 */
@Injectable()
export class CachedReviewRepository implements ReviewRepository {
  /**
   * @param inner - Repositorio que lee de Postgres.
   * @param cache - Caché de lecturas.
   */
  constructor(
    @Inject(PrismaReviewRepository) private readonly inner: ReviewRepository,
    @Inject(CACHE_PORT) private readonly cache: CachePort,
  ) {}

  /** {@inheritDoc ReviewRepository.listApprovedByProduct} */
  async listApprovedByProduct(productId: string): Promise<ProductReview[]> {
    const reviews = await readThrough<CachedReview[]>(
      this.cache,
      productReviewsCacheKey(productId, await catalogCacheVersion(this.cache)),
      CATALOG_CACHE_TTL_SECONDS,
      async () => (await this.inner.listApprovedByProduct(productId)).map(toCached),
    )
    return reviews.map(fromCached)
  }

  /** {@inheritDoc ReviewRepository.listFeatured} */
  async listFeatured(): Promise<FeaturedProductReview[]> {
    const featured = await readThrough<CachedFeaturedReview[]>(
      this.cache,
      featuredReviewsCacheKey(await catalogCacheVersion(this.cache)),
      CATALOG_CACHE_TTL_SECONDS,
      async () =>
        (await this.inner.listFeatured()).map(({ review, product }) => ({
          review: toCached(review),
          product,
        })),
    )
    return featured.map(({ review, product }) => ({ review: fromCached(review), product }))
  }
}
