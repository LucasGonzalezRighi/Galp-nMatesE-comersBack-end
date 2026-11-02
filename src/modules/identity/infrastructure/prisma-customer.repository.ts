import { Injectable } from '@nestjs/common'

import type { Prisma } from '../../../generated/prisma/client'
import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service'
import type {
  CustomerPatch,
  CustomerRepository,
  NewCustomer,
} from '../application/ports/customer.repository.port'
import type { NewUser } from '../application/ports/user.repository.port'
import type { Customer } from '../domain/customer.entity'
import { EmailAlreadyRegisteredError } from '../domain/identity-errors'
import { toCustomer, translateEmailTaken } from './identity.mapper'

/** Clientes con Prisma (Postgres): con cuenta o invitados; el email es `citext` y único. */
@Injectable()
export class PrismaCustomerRepository implements CustomerRepository {
  /** @param prisma - Cliente de Prisma de la app. */
  constructor(private readonly prisma: PrismaService) {}

  /** {@inheritDoc CustomerRepository.findByUserId} */
  async findByUserId(userId: string): Promise<Customer | null> {
    const row = await this.prisma.customer.findUnique({ where: { userId } })
    return row === null ? null : toCustomer(row)
  }

  /** {@inheritDoc CustomerRepository.findByEmail} */
  async findByEmail(email: string): Promise<Customer | null> {
    const row = await this.prisma.customer.findUnique({ where: { email } })
    return row === null ? null : toCustomer(row)
  }

  /** {@inheritDoc CustomerRepository.create} */
  async create(input: NewCustomer): Promise<Customer> {
    return toCustomer(await this.prisma.customer.create({ data: { ...input } }))
  }

  /**
   * {@inheritDoc CustomerRepository.createWithUser}
   *
   * Es un solo `INSERT` anidado (cliente con su usuario): Prisma lo corre en una transacción.
   */
  async createWithUser(user: NewUser, customer: Omit<NewCustomer, 'userId'>): Promise<Customer> {
    const row = await translateEmailTaken(() =>
      this.prisma.customer.create({ data: { ...customer, user: { create: { ...user } } } }),
    )
    return toCustomer(row)
  }

  /**
   * {@inheritDoc CustomerRepository.attachUser}
   *
   * En una transacción: crea el usuario y se lo asigna al cliente solo si sigue sin cuenta
   * (`updateMany` con `userId: null`); si otro registro lo ganó, la transacción se deshace.
   */
  async attachUser(
    customerId: string,
    user: NewUser,
    names: { firstName: string; lastName: string },
  ): Promise<Customer> {
    const row = await translateEmailTaken(() =>
      this.prisma.$transaction(async (tx) => {
        await tx.user.create({ data: { ...user } })
        const { count } = await tx.customer.updateMany({
          where: { id: customerId, userId: null },
          data: { userId: user.id, firstName: names.firstName, lastName: names.lastName },
        })
        if (count !== 1) throw new EmailAlreadyRegisteredError()
        return tx.customer.findUniqueOrThrow({ where: { id: customerId } })
      }),
    )
    return toCustomer(row)
  }

  /** {@inheritDoc CustomerRepository.update} */
  async update(id: string, patch: CustomerPatch): Promise<Customer> {
    const data: Prisma.CustomerUpdateInput = {}
    if (patch.firstName !== undefined) data.firstName = patch.firstName
    if (patch.lastName !== undefined) data.lastName = patch.lastName
    if (patch.phone !== undefined) data.phone = patch.phone
    return toCustomer(await this.prisma.customer.update({ where: { id }, data }))
  }
}
