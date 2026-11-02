import type { AddressRepository } from '../ports/address.repository.port'
import type { AddressView } from '../read-models'
import { toAddressView } from '../views'

/** Libreta de direcciones del cliente (`GET /me/addresses`): la predeterminada primero. */
export class ListMyAddressesQuery {
  /** @param addresses - Libreta de direcciones. */
  constructor(private readonly addresses: AddressRepository) {}

  /**
   * @param customerId - Cliente de la sesión.
   * @returns Sus direcciones, la predeterminada primero y después por orden de alta.
   */
  async execute(customerId: string): Promise<AddressView[]> {
    const addresses = await this.addresses.listByCustomer(customerId)
    return addresses.map(toAddressView)
  }
}
