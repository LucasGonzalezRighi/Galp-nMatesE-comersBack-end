import type { ModeratedReview, ReviewStatus } from '../../domain/review-moderation'
import type { ReviewModerationRepository } from '../ports/review-moderation.repository.port'
import type { AdminReview, AdminReviewPage } from '../read-models'
import { toReview } from './list-product-reviews.query'

/** Reseñas por página en el dashboard (fijo, como el mock del front). */
export const ADMIN_REVIEWS_PAGE_SIZE = 20

/**
 * Pasa una reseña en cualquier estado a la forma `AdminReview` del contrato.
 *
 * @param review - Reseña con su producto.
 * @returns La reseña pública más `status`, `featured` y el producto.
 */
export function toAdminReview(review: ModeratedReview): AdminReview {
  return {
    ...toReview(review),
    status: review.status,
    featured: review.featured,
    product: { slug: review.product.slug, name: review.product.name },
  }
}

/** Reseñas del dashboard: en cualquier estado, de la más nueva a la más vieja, de a 20. */
export class ListAdminReviewsQuery {
  /** @param reviews - Reseñas en cualquier estado. */
  constructor(private readonly reviews: Pick<ReviewModerationRepository, 'list'>) {}

  /**
   * @param status - Solo las de ese estado; sin él, todas.
   * @param page - Página, desde 1 (fuera de rango: `items` vacío con el total real).
   * @returns La página con la forma `AdminReviewPage` del contrato.
   * @throws {RangeError} En español, si la página no es un entero mayor o igual a 1.
   */
  async execute(status: ReviewStatus | undefined, page: number): Promise<AdminReviewPage> {
    if (!Number.isSafeInteger(page) || page < 1) {
      throw new RangeError(`La página tiene que ser un entero desde 1; se recibió ${String(page)}.`)
    }
    const { items, total } = await this.reviews.list(status, page, ADMIN_REVIEWS_PAGE_SIZE)
    return { items: items.map(toAdminReview), page, pageSize: ADMIN_REVIEWS_PAGE_SIZE, total }
  }
}
