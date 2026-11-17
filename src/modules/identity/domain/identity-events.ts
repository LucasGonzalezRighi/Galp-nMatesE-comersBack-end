import type { NewDomainEvent } from '../../../shared/domain/domain-event'

/** Tipo de agregado de los eventos de clientes. */
export const CUSTOMER_AGGREGATE = 'customer'

/** Evento de cuenta de cliente creada (B7 manda el mail de bienvenida). */
export const CUSTOMER_REGISTERED_EVENT = 'customer.registered'

/**
 * Evento `customer.registered` para el outbox, en la misma transacción que el alta. El payload
 * lleva solo el id (nunca el email ni el nombre).
 *
 * @param customerId - Id del cliente de la cuenta nueva.
 * @returns El evento con `{ customerId }`.
 * @throws {TypeError} En español, si falta el id.
 */
export function customerRegisteredEvent(customerId: string): NewDomainEvent {
  if (customerId.trim() === '') throw new TypeError('El evento de registro necesita el cliente')
  return {
    type: CUSTOMER_REGISTERED_EVENT,
    aggregateType: CUSTOMER_AGGREGATE,
    aggregateId: customerId,
    payload: { customerId },
  }
}
