import { isId } from '../../../../shared/domain/id'
import { AddressNotFoundError } from '../../domain/identity-errors'
import type { AddressRepository } from '../ports/address.repository.port'

/** Baja de una dirección de la libreta. */
export class DeleteMyAddressCommand {
  /** @param addresses - Libreta de direcciones. */
  constructor(private readonly addresses: AddressRepository) {}

  /**
   * @param customerId - Cliente de la sesión.
   * @param id - Id de la dirección (de la ruta).
   * @throws {AddressNotFoundError} Si el id no existe, no tiene formato de id o es de otro cliente.
   */
  async execute(customerId: string, id: string): Promise<void> {
    if (!isId(id) || (await this.addresses.findOne(customerId, id)) === null) {
      throw new AddressNotFoundError()
    }
    await this.addresses.delete(id)
  }
}
