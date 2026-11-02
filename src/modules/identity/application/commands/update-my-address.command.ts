import { isId } from '../../../../shared/domain/id'
import { type AddressInput, normalizeAddressInput } from '../../domain/address.entity'
import { AddressNotFoundError } from '../../domain/identity-errors'
import type { AddressRepository } from '../ports/address.repository.port'
import type { AddressView } from '../read-models'
import { toAddressView } from '../views'

/** Reemplazo de una dirección de la libreta; si pasa a predeterminada, la anterior deja de serlo. */
export class UpdateMyAddressCommand {
  /** @param addresses - Libreta de direcciones. */
  constructor(private readonly addresses: AddressRepository) {}

  /**
   * @param customerId - Cliente de la sesión.
   * @param id - Id de la dirección (de la ruta).
   * @param input - Datos nuevos (se normalizan).
   * @returns La dirección actualizada.
   * @throws {AddressNotFoundError} Si el id no existe, no tiene formato de id o es de otro cliente.
   * @throws {TypeError} En español, si un campo obligatorio queda vacío o la provincia no existe.
   */
  async execute(customerId: string, id: string, input: AddressInput): Promise<AddressView> {
    const normalized = normalizeAddressInput(input)
    if (!isId(id) || (await this.addresses.findOne(customerId, id)) === null) {
      throw new AddressNotFoundError()
    }
    return toAddressView(await this.addresses.replace(id, normalized))
  }
}
