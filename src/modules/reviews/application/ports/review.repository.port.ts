import type { ProductReview } from '../../domain/review.entity'

/** Reseña destacada con el producto al que pertenece. */
export interface FeaturedProductReview {
  /** La reseña. */
  review: ProductReview
  /** Slug actual y nombre del producto (publicado). */
  product: { slug: string; name: string }
}

/** Lecturas de reseñas aprobadas. */
export interface ReviewRepository {
  /**
   * Reseñas aprobadas de un producto, de la más nueva a la más vieja.
   *
   * @param productId - Id del producto.
   */
  listApprovedByProduct(productId: string): Promise<ProductReview[]>

  /** Reseñas aprobadas y destacadas de productos publicados, de la más nueva a la más vieja. */
  listFeatured(): Promise<FeaturedProductReview[]>
}

/** Token de inyección del {@link ReviewRepository}. */
export const REVIEW_REPOSITORY = Symbol('REVIEW_REPOSITORY')
