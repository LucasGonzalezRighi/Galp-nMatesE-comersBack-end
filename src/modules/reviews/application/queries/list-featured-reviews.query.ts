import type { ReviewRepository } from '../ports/review.repository.port'
import type { FeaturedReview } from '../read-models'
import { toReview } from './list-product-reviews.query'

/** Reseñas destacadas del inicio, con el producto de cada una. */
export class ListFeaturedReviewsQuery {
  /** @param reviews - Lecturas de reseñas. */
  constructor(private readonly reviews: ReviewRepository) {}

  /**
   * Devuelve las reseñas aprobadas y destacadas de productos publicados.
   *
   * @returns Las reseñas con su producto, de la más nueva a la más vieja.
   */
  async execute(): Promise<FeaturedReview[]> {
    const featured = await this.reviews.listFeatured()
    return featured
      .toSorted((a, b) => b.review.createdAt.getTime() - a.review.createdAt.getTime())
      .map(({ review, product }) => ({
        ...toReview(review),
        product: { slug: product.slug, name: product.name },
      }))
  }
}
