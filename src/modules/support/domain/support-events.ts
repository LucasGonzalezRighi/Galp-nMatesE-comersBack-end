import type { NewDomainEvent } from '../../../shared/domain/domain-event'
import type { ContactMessageKind } from './contact-message'

/** Tipo de agregado de los eventos de la bandeja. */
export const CONTACT_MESSAGE_AGGREGATE = 'contact_message'

/** Evento de solicitud de arrepentimiento guardada (B7 manda el código por mail). */
export const WITHDRAWAL_REQUESTED_EVENT = 'withdrawal.requested'

/** Evento de mensaje de contacto guardado (B7 le avisa por mail a quien escribió). */
export const CONTACT_RECEIVED_EVENT = 'contact.received'

/**
 * Evento de un mensaje nuevo de la bandeja, para el outbox (en la misma transacción que el
 * mensaje). El payload lleva solo el id: el mail lee los datos al mandarse.
 *
 * @param message - Id y tipo del mensaje guardado.
 * @returns `withdrawal.requested { requestId }` o `contact.received { messageId }`.
 * @throws {TypeError} En español, si falta el id.
 */
export function supportMessageEvent(message: {
  id: string
  kind: ContactMessageKind
}): NewDomainEvent {
  if (message.id.trim() === '') throw new TypeError('El evento de la bandeja necesita el id')
  return message.kind === 'withdrawal'
    ? {
        type: WITHDRAWAL_REQUESTED_EVENT,
        aggregateType: CONTACT_MESSAGE_AGGREGATE,
        aggregateId: message.id,
        payload: { requestId: message.id },
      }
    : {
        type: CONTACT_RECEIVED_EVENT,
        aggregateType: CONTACT_MESSAGE_AGGREGATE,
        aggregateId: message.id,
        payload: { messageId: message.id },
      }
}
