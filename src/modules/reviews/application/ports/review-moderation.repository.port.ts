import type { NewDomainEvent } from '../../../../shared/domain/domain-event'
import type {
  ModeratedReview,
  NewReview,
  ReviewPatch,
  ReviewStatus,
} from '../../domain/review-moderation'

/** Página de reseñas en cualquier estado, de la más nueva a la más vieja. */
export interface ModeratedReviewSlice {
  /** Reseñas de la página. */
  items: ModeratedReview[]
  /** Total de reseñas que cumplen el filtro. */
  total: number
}

/** Reseñas en cualquier estado: las que mandan los visitantes y su moderación en el dashboard. */
export interface ReviewModerationRepository {
  /**
   * Guarda una reseña nueva `pending`, sin compra verificada y sin destacar.
   *
   * @param review - Reseña ya revisada.
   */
  submit(review: NewReview): Promise<void>

  /**
   * Una página de reseñas, de la más nueva a la más vieja.
   *
   * @param status - Solo las de ese estado; sin él, todas.
   * @param page - Página, desde 1.
   * @param pageSize - Reseñas por página.
   */
  list(
    status: ReviewStatus | undefined,
    page: number,
    pageSize: number,
  ): Promise<ModeratedReviewSlice>

  /**
   * Busca una reseña por id.
   *
   * @param id - Id tal como llegó (uno que no es un UUID no existe).
   * @returns La reseña con su producto, o `null`.
   */
  findById(id: string): Promise<ModeratedReview | null>

  /**
   * Escribe la moderación y el aviso a la tienda en la misma transacción; después del commit
   * sube la versión de la caché del catálogo (el promedio de los listados cambia).
   *
   * @param id - Id de la reseña.
   * @param patch - Campos a escribir.
   * @param event - Aviso `storefront.stale` para el outbox.
   * @returns La reseña como quedó, o `null` si ya no existe.
   */
  update(id: string, patch: ReviewPatch, event: NewDomainEvent): Promise<ModeratedReview | null>
}

/** Token de inyección del {@link ReviewModerationRepository}. */
export const REVIEW_MODERATION_REPOSITORY = Symbol('REVIEW_MODERATION_REPOSITORY')
