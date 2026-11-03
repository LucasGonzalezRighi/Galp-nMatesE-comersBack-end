import { Inject, Injectable } from '@nestjs/common'

import { newId } from '../../../shared/domain/id'
import { isUniqueViolation } from '../../../shared/infrastructure/prisma/prisma-errors'
import {
  CUSTOMER_REPOSITORY,
  type CustomerRepository,
} from '../../identity/application/ports/customer.repository.port'
import type {
  CustomerDirectoryPort,
  DirectoryCustomer,
} from '../application/ports/customer-directory.port'
import type { OrderContact } from '../domain/order.entity'

/** Valida que un texto no esté vacío. */
function assertText(value: string, label: string): void {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${label} no puede estar vacío`)
  }
}

/**
 * Clientes para el dueño del pedido, sobre el `CUSTOMER_REPOSITORY` de identidad (exportado por
 * `IdentityModule`). Un invitado es un cliente con `user_id null`.
 */
@Injectable()
export class IdentityCustomersAdapter implements CustomerDirectoryPort {
  /** @param customers - Clientes de identidad. */
  constructor(@Inject(CUSTOMER_REPOSITORY) private readonly customers: CustomerRepository) {}

  /** {@inheritDoc CustomerDirectoryPort.findByEmail} */
  async findByEmail(email: string): Promise<DirectoryCustomer | null> {
    assertText(email, 'El email')
    const customer = await this.customers.findByEmail(email)
    return customer === null ? null : { id: customer.id, userId: customer.userId }
  }

  /**
   * {@inheritDoc CustomerDirectoryPort.createGuest}
   *
   * Si el `INSERT` choca con el email único (`P2002`, otro pedido lo creó a la vez), devuelve el
   * cliente que ganó.
   *
   * @throws {TypeError} En español, si falta el email.
   */
  async createGuest(input: OrderContact): Promise<{ id: string }> {
    assertText(input.email, 'El email')
    try {
      const created = await this.customers.create({
        id: newId(),
        userId: null,
        email: input.email,
        firstName: input.firstName,
        lastName: input.lastName,
        phone: input.phone,
      })
      return { id: created.id }
    } catch (error) {
      if (!isUniqueViolation(error)) throw error
      const existing = await this.customers.findByEmail(input.email)
      if (existing === null) throw error
      return { id: existing.id }
    }
  }

  /**
   * {@inheritDoc CustomerDirectoryPort.updateGuest}
   *
   * @throws {TypeError} En español, si falta el id.
   */
  async updateGuest(id: string, input: Omit<OrderContact, 'email'>): Promise<void> {
    assertText(id, 'El id del cliente')
    await this.customers.update(id, {
      firstName: input.firstName,
      lastName: input.lastName,
      phone: input.phone,
    })
  }
}
