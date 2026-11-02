import { Module } from '@nestjs/common'

import { CatalogModule } from '../catalog/catalog.module'
import {
  PRODUCT_LOOKUP_PORT,
  type ProductLookupPort,
} from './application/ports/product-lookup.port'
import {
  REVIEW_REPOSITORY,
  type ReviewRepository,
} from './application/ports/review.repository.port'
import { ListFeaturedReviewsQuery } from './application/queries/list-featured-reviews.query'
import { ListProductReviewsQuery } from './application/queries/list-product-reviews.query'
import { CatalogProductLookupAdapter } from './infrastructure/catalog-product-lookup.adapter'
import { PrismaReviewRepository } from './infrastructure/prisma-review.repository'
import { ReviewsController } from './interface/reviews.controller'

/**
 * Reseñas (lectura): las aprobadas de un producto con sus estadísticas y las destacadas del
 * inicio, en `GET /products/{slug}/reviews` y `GET /reviews/featured`. Sin caché (spec §3.2).
 * El envío de reseñas llega en B7.
 */
@Module({
  imports: [CatalogModule],
  controllers: [ReviewsController],
  providers: [
    { provide: REVIEW_REPOSITORY, useClass: PrismaReviewRepository },
    { provide: PRODUCT_LOOKUP_PORT, useClass: CatalogProductLookupAdapter },
    {
      provide: ListProductReviewsQuery,
      useFactory: (reviews: ReviewRepository, products: ProductLookupPort) =>
        new ListProductReviewsQuery(reviews, products),
      inject: [REVIEW_REPOSITORY, PRODUCT_LOOKUP_PORT],
    },
    {
      provide: ListFeaturedReviewsQuery,
      useFactory: (reviews: ReviewRepository) => new ListFeaturedReviewsQuery(reviews),
      inject: [REVIEW_REPOSITORY],
    },
  ],
  exports: [ListProductReviewsQuery, ListFeaturedReviewsQuery],
})
export class ReviewsModule {}
