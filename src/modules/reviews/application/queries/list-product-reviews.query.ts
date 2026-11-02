import { ratingDistribution, summarizeRatings } from '../../domain/rating'
import type { ProductReview } from '../../domain/review.entity'
import type { ProductLookupPort } from '../ports/product-lookup.port'
import type { ReviewRepository } from '../ports/review.repository.port'
import type { Review, ReviewPage } from '../read-models'

/** Reseñas por página en la ficha del producto (fijo, como el mock del front). */
export const REVIEWS_PAGE_SIZE = 10

/**
 * Pasa una reseña del dominio a la forma pública `Review`.
 *
 * @param review - Reseña aprobada.
 * @returns La reseña con la fecha en ISO 8601.
 */
export function toReview(review: ProductReview): Review {
  return {
    id: review.id,
    authorName: review.authorName,
    rating: review.rating,
    text: review.text,
    createdAt: review.createdAt.toISOString(),
    verifiedPurchase: review.verifiedPurchase,
  }
}

/** Reseñas aprobadas de un producto, paginadas, con promedio y distribución de todas. */
export class ListProductReviewsQuery {
  /**
   * @param reviews - Lecturas de reseñas.
   * @param products - Búsqueda del producto por slug (actual o anterior).
   */
  constructor(
    private readonly reviews: ReviewRepository,
    private readonly products: ProductLookupPort,
  ) {}

  /**
   * Devuelve una página de reseñas aprobadas de un producto publicado.
   *
   * @param slug - Slug del producto, actual o anterior.
   * @param page - Página, desde 1.
   * @returns La página con `stats` de todas las aprobadas, o `null` si no hay un producto
   *   publicado con ese slug.
   * @throws {RangeError} En español, si la página no es un entero mayor o igual a 1.
   */
  async execute(slug: string, page: number): Promise<ReviewPage | null> {
    if (!Number.isInteger(page) || page < 1) {
      throw new RangeError(`La página tiene que ser un entero desde 1; se recibió ${String(page)}.`)
    }
    const productId = await this.products.findPublishedIdBySlug(slug)
    if (productId === null) return null

    const approved = await this.reviews.listApprovedByProduct(productId)
    const ratings = approved.map((review) => review.rating)
    const start = (page - 1) * REVIEWS_PAGE_SIZE
    return {
      items: approved.slice(start, start + REVIEWS_PAGE_SIZE).map(toReview),
      page,
      pageSize: REVIEWS_PAGE_SIZE,
      total: approved.length,
      stats: { ...summarizeRatings(ratings), distribution: ratingDistribution(ratings) },
    }
  }
}
