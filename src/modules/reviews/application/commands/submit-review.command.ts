import { isHoneypotFilled } from '../../../../shared/domain/honeypot'
import { authorNameOrAnonymous, createNewReview } from '../../domain/review-moderation'
import type { ProductLookupPort } from '../ports/product-lookup.port'
import type { ReviewModerationRepository } from '../ports/review-moderation.repository.port'
import type { ReviewReceipt } from '../read-models'

/** Reseña que manda un visitante, ya validada (`ReviewInput`). */
export interface ReviewInput {
  /** Puntuación de 1 a 5, múltiplo de 0,5. */
  rating: number
  /** Nombre recortado, o `null` para firmar como "Anónimo". */
  authorName: string | null
  /** Texto recortado. */
  text: string
  /** Campo trampa: `null` o `''` para las personas. */
  website: string | null
}

/**
 * Recibe la reseña de un producto publicado: queda `pending` (no se muestra ni cuenta hasta que el
 * admin la apruebe), sin compra verificada y firmada "Anónimo" si no trae nombre. Primero busca el
 * producto (404 aunque el campo trampa venga lleno, como el mock); con el campo trampa lleno
 * responde igual y no guarda nada. No avisa a la tienda: una pendiente no se ve.
 */
export class SubmitReviewCommand {
  /**
   * @param products - Búsqueda del producto publicado por slug (actual o anterior).
   * @param reviews - Reseñas en cualquier estado.
   */
  constructor(
    private readonly products: ProductLookupPort,
    private readonly reviews: Pick<ReviewModerationRepository, 'submit'>,
  ) {}

  /**
   * @param slug - Slug del producto, actual o anterior.
   * @param input - Reseña ya validada.
   * @returns La confirmación `{ status: 'pending' }`, o `null` si no hay un producto publicado
   *   con ese slug (404).
   * @throws {RangeError} En español, si la puntuación no es un múltiplo de 0,5 de 1 a 5.
   * @throws {TypeError} En español, si falta el texto o el nombre pasa de 40 caracteres.
   */
  async execute(slug: string, input: ReviewInput): Promise<ReviewReceipt | null> {
    const productId = await this.products.findPublishedIdBySlug(slug)
    if (productId === null) return null
    if (!isHoneypotFilled(input.website)) {
      await this.reviews.submit(
        createNewReview({
          productId,
          authorName: authorNameOrAnonymous(input.authorName),
          rating: input.rating,
          text: input.text,
        }),
      )
    }
    return { status: 'pending' }
  }
}
