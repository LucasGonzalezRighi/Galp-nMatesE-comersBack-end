import { DomainError } from '../../../shared/domain/domain-error'

/**
 * 429 `rate_limited` (NV-21): la IP ya mandó `MAX_PENDING_REVIEWS_PER_IP` reseñas en el día.
 * `Retry-After` dice cuánto falta para que se libere el cupo.
 */
export class TooManyReviewsError extends DomainError {
  /** @param retryAfterSeconds - Segundos que faltan para que se libere el cupo. */
  constructor(retryAfterSeconds: number) {
    super(
      'rate_limited',
      429,
      'Ya recibimos varias reseñas tuyas hoy. Probá de nuevo mañana.',
      'Demasiadas reseñas',
      { retryAfterSeconds },
    )
    this.name = 'TooManyReviewsError'
  }
}

/** 404 `not_found`: no hay una reseña con ese id (o el id no es un UUID). */
export class ReviewNotFoundError extends DomainError {
  constructor() {
    super('not_found', 404, 'No existe esa reseña.')
    this.name = 'ReviewNotFoundError'
  }
}
