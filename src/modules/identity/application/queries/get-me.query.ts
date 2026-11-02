import type { SessionRecord } from '../../../../shared/application/ports/session.port'
import { StaleSessionError } from '../../domain/identity-errors'
import type { CustomerRepository } from '../ports/customer.repository.port'
import type { CustomerView } from '../read-models'
import { toCustomerView } from '../views'

/** Datos del cliente de la sesión (`GET /me`). */
export class GetMeQuery {
  /** @param customers - Clientes. */
  constructor(private readonly customers: CustomerRepository) {}

  /**
   * @param session - Sesión de cliente (la que dejó el guard).
   * @returns Los datos del cliente.
   * @throws {TypeError} En español, si la sesión no es de cliente.
   * @throws {StaleSessionError} Si la cuenta ya no tiene cliente.
   */
  async execute(session: SessionRecord): Promise<CustomerView> {
    if (session.kind !== 'customer' || session.userId === null) {
      throw new TypeError('Los datos del cliente necesitan una sesión de cliente')
    }
    const customer = await this.customers.findByUserId(session.userId)
    if (customer === null) throw new StaleSessionError()
    return toCustomerView(customer)
  }
}
