import { normalizePersonName } from '../../domain/customer.entity'
import type { CustomerPatch, CustomerRepository } from '../ports/customer.repository.port'
import type { CustomerView } from '../read-models'
import { toCustomerView } from '../views'

/** Cambio de los datos del cliente (`PATCH /me`): solo los campos que vienen. */
export class UpdateMeCommand {
  /** @param customers - Clientes. */
  constructor(private readonly customers: CustomerRepository) {}

  /**
   * @param customerId - Cliente de la sesión.
   * @param patch - Nombre, apellido y/o teléfono (`null` lo borra).
   * @returns Los datos actualizados.
   * @throws {TypeError} En español, si un nombre queda vacío.
   */
  async execute(customerId: string, patch: CustomerPatch): Promise<CustomerView> {
    const changes: CustomerPatch = {}
    if (patch.firstName !== undefined) changes.firstName = normalizePersonName(patch.firstName)
    if (patch.lastName !== undefined) changes.lastName = normalizePersonName(patch.lastName)
    if (patch.phone !== undefined) changes.phone = patch.phone
    return toCustomerView(await this.customers.update(customerId, changes))
  }
}
