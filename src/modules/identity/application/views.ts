import type { Address } from '../domain/address.entity'
import type { Customer } from '../domain/customer.entity'
import type { AddressView, CustomerView } from './read-models'

/**
 * Pasa un cliente a la forma pública `Customer` (sin ids ni usuario).
 *
 * @param customer - Cliente.
 * @returns Email, nombre, apellido y teléfono.
 */
export function toCustomerView(customer: Customer): CustomerView {
  const { email, firstName, lastName, phone } = customer
  return { email, firstName, lastName, phone }
}

/**
 * Pasa una dirección a la forma pública `Address` (sin el cliente dueño).
 *
 * @param address - Dirección de la libreta.
 * @returns La dirección con su id.
 */
export function toAddressView(address: Address): AddressView {
  const { id, label, street, number, apartment, postalCode, city, province, isDefault } = address
  return { id, label, street, number, apartment, postalCode, city, province, isDefault }
}
