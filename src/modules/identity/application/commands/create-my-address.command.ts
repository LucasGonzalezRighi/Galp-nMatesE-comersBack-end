import { newId } from '../../../../shared/domain/id'
import { type AddressInput, normalizeAddressInput } from '../../domain/address.entity'
import type { AddressRepository } from '../ports/address.repository.port'
import type { AddressView } from '../read-models'
import { toAddressView } from '../views'

/** Alta de una dirección en la libreta; si es la predeterminada, la anterior deja de serlo. */
export class CreateMyAddressCommand {
  /** @param addresses - Libreta de direcciones. */
  constructor(private readonly addresses: AddressRepository) {}

  /**
   * @param customerId - Cliente de la sesión.
   * @param input - Dirección (se normaliza).
   * @returns La dirección creada.
   * @throws {TypeError} En español, si un campo obligatorio queda vacío o la provincia no existe.
   */
  async execute(customerId: string, input: AddressInput): Promise<AddressView> {
    const address = await this.addresses.create({
      ...normalizeAddressInput(input),
      id: newId(),
      customerId,
    })
    return toAddressView(address)
  }
}
