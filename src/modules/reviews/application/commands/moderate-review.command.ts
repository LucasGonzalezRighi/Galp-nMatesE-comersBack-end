import type { Clock } from '../../../../shared/domain/clock'
import { storefrontStaleEvent } from '../../../../shared/domain/storefront-tags'
import {
  moderationPatch,
  REVIEW_MODERATED_REASON,
  type ReviewUpdate,
  reviewStorefrontTags,
} from '../../domain/review-moderation'
import { ReviewNotFoundError } from '../../domain/reviews-errors'
import type { ReviewModerationRepository } from '../ports/review-moderation.repository.port'
import type { AdminReview } from '../read-models'
import { toAdminReview } from '../queries/list-admin-reviews.query'

/**
 * Modera una reseña desde el dashboard: cambia solo lo que viene (`status` y/o `featured`), pone
 * `moderatedAt` si cambia el estado (comparado con el estado que lee la transacción, con la fila
 * bloqueada, no con el de la lectura previa) y, en la misma transacción, le avisa a la tienda con
 * `storefront.stale` (`review.moderated`: `reviews:featured`, `reviews:{slug}`, `product:{slug}`,
 * `products`), siempre, aunque solo cambie `featured` (como el mock). Después del commit el
 * repositorio sube la versión de la caché del catálogo.
 */
export class ModerateReviewCommand {
  /**
   * @param reviews - Reseñas en cualquier estado.
   * @param clock - Reloj (fecha de moderación).
   */
  constructor(
    private readonly reviews: Pick<ReviewModerationRepository, 'findById' | 'update'>,
    private readonly clock: Clock,
  ) {}

  /**
   * @param id - Id de la reseña, tal como llegó en la ruta.
   * @param update - Cambio ya validado (al menos un campo).
   * @returns La reseña como quedó, con la forma `AdminReview` del contrato.
   * @throws {ReviewNotFoundError} Si no existe (o el id no es un UUID): 404.
   * @throws {TypeError} En español, si el cambio no trae ningún campo.
   */
  async execute(id: string, update: ReviewUpdate): Promise<AdminReview> {
    const current = await this.reviews.findById(id)
    if (current === null) throw new ReviewNotFoundError()
    const now = this.clock.now()
    const event = storefrontStaleEvent(
      REVIEW_MODERATED_REASON,
      reviewStorefrontTags(current.product.slug),
    )
    const updated = await this.reviews.update(
      current.id,
      (locked) => moderationPatch(locked, update, now),
      event,
    )
    if (updated === null) throw new ReviewNotFoundError()
    return toAdminReview(updated)
  }
}
