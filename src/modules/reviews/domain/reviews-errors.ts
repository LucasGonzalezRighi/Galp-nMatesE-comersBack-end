import { DomainError } from '../../../shared/domain/domain-error'

/** 404 `not_found`: no hay una reseña con ese id (o el id no es un UUID). */
export class ReviewNotFoundError extends DomainError {
  constructor() {
    super('not_found', 404, 'No existe esa reseña.')
    this.name = 'ReviewNotFoundError'
  }
}
