import { DomainError } from '../../../shared/domain/domain-error'

/** 404 `not_found`: no hay un mensaje con ese id (o el id no es un UUID). */
export class MessageNotFoundError extends DomainError {
  constructor() {
    super('not_found', 404, 'No existe ese mensaje.')
    this.name = 'MessageNotFoundError'
  }
}
