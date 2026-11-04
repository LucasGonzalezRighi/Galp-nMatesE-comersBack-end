import { Module } from '@nestjs/common'

import { CLOCK, type Clock } from '../../shared/domain/clock'
import { CatalogModule } from '../catalog/catalog.module'
import { ModerateReviewCommand } from './application/commands/moderate-review.command'
import { SubmitReviewCommand } from './application/commands/submit-review.command'
import {
  PRODUCT_LOOKUP_PORT,
  type ProductLookupPort,
} from './application/ports/product-lookup.port'
import {
  REVIEW_MODERATION_REPOSITORY,
  type ReviewModerationRepository,
} from './application/ports/review-moderation.repository.port'
import {
  REVIEW_REPOSITORY,
  type ReviewRepository,
} from './application/ports/review.repository.port'
import { ListAdminReviewsQuery } from './application/queries/list-admin-reviews.query'
import { ListFeaturedReviewsQuery } from './application/queries/list-featured-reviews.query'
import { ListProductReviewsQuery } from './application/queries/list-product-reviews.query'
import { CatalogProductLookupAdapter } from './infrastructure/catalog-product-lookup.adapter'
import { PrismaReviewModerationRepository } from './infrastructure/prisma-review-moderation.repository'
import { PrismaReviewRepository } from './infrastructure/prisma-review.repository'
import { AdminReviewsController } from './interface/admin-reviews.controller'
import { ReviewsController } from './interface/reviews.controller'

/**
 * Reseñas: las aprobadas de un producto con sus estadísticas y las destacadas del inicio
 * (`GET /products/{slug}/reviews` y `GET /reviews/featured`, sin caché, spec §3.2), el envío de
 * una reseña nueva que queda pendiente (`POST /products/{slug}/reviews`) y la moderación del
 * dashboard (`GET /admin/reviews` y `PATCH /admin/reviews/{id}`), que le avisa a la tienda y sube
 * la versión de la caché del catálogo (Ruling B-77).
 */
@Module({
  imports: [CatalogModule],
  controllers: [ReviewsController, AdminReviewsController],
  providers: [
    { provide: REVIEW_REPOSITORY, useClass: PrismaReviewRepository },
    { provide: PRODUCT_LOOKUP_PORT, useClass: CatalogProductLookupAdapter },
    { provide: REVIEW_MODERATION_REPOSITORY, useClass: PrismaReviewModerationRepository },
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
    {
      provide: SubmitReviewCommand,
      useFactory: (products: ProductLookupPort, reviews: ReviewModerationRepository) =>
        new SubmitReviewCommand(products, reviews),
      inject: [PRODUCT_LOOKUP_PORT, REVIEW_MODERATION_REPOSITORY],
    },
    {
      provide: ListAdminReviewsQuery,
      useFactory: (reviews: ReviewModerationRepository) => new ListAdminReviewsQuery(reviews),
      inject: [REVIEW_MODERATION_REPOSITORY],
    },
    {
      provide: ModerateReviewCommand,
      useFactory: (reviews: ReviewModerationRepository, clock: Clock) =>
        new ModerateReviewCommand(reviews, clock),
      inject: [REVIEW_MODERATION_REPOSITORY, CLOCK],
    },
  ],
  exports: [ListProductReviewsQuery, ListFeaturedReviewsQuery],
})
export class ReviewsModule {}
