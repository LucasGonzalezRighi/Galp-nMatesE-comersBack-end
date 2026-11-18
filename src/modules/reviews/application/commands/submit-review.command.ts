import { isHoneypotFilled } from '../../../../shared/domain/honeypot'
import { authorNameOrAnonymous, createNewReview } from '../../domain/review-moderation'
import { TooManyReviewsError } from '../../domain/reviews-errors'
import type { ProductLookupPort } from '../ports/product-lookup.port'
import type { ReviewModerationRepository } from '../ports/review-moderation.repository.port'
import type { ReviewQuotaPort } from '../ports/review-quota.port'
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
 *
 * Cada reseña que se guarda cuenta en el cupo diario de la IP real del cliente (NV-21); sin IP
 * conocida (sin `TRUST_PROXY` ni `TRUSTED_PROXY_SECRET`, o pedida por el servidor de la tienda
 * sin la IP del cliente) no se cuenta: queda el límite por IP de la ruta.
 */
export class SubmitReviewCommand {
  /**
   * @param products - Búsqueda del producto publicado por slug (actual o anterior).
   * @param reviews - Reseñas en cualquier estado.
   * @param quota - Cupo diario de reseñas por IP.
   */
  constructor(
    private readonly products: ProductLookupPort,
    private readonly reviews: Pick<ReviewModerationRepository, 'submit'>,
    private readonly quota: ReviewQuotaPort,
  ) {}

  /**
   * @param slug - Slug del producto, actual o anterior.
   * @param input - Reseña ya validada.
   * @returns La confirmación `{ status: 'pending' }`, o `null` si no hay un producto publicado
   *   con ese slug (404).
   * @throws {RangeError} En español, si la puntuación no es un múltiplo de 0,5 de 1 a 5.
   * @param clientIp - IP real del cliente, o `null` si no se conoce (no se cuenta en el cupo).
   * @throws {TypeError} En español, si falta el texto o el nombre pasa de 40 caracteres.
   * @throws {TooManyReviewsError} 429 si la IP ya agotó el cupo del día (no se guarda nada).
   */
  async execute(
    slug: string,
    input: ReviewInput,
    clientIp: string | null,
  ): Promise<ReviewReceipt | null> {
    const productId = await this.products.findPublishedIdBySlug(slug)
    if (productId === null) return null
    if (isHoneypotFilled(input.website)) return { status: 'pending' }
    const review = createNewReview({
      productId,
      authorName: authorNameOrAnonymous(input.authorName),
      rating: input.rating,
      text: input.text,
    })
    if (clientIp !== null) {
      const retryAfterSeconds = await this.quota.take(clientIp)
      if (retryAfterSeconds !== null) throw new TooManyReviewsError(retryAfterSeconds)
    }
    await this.reviews.submit(review)
    return { status: 'pending' }
  }
}
