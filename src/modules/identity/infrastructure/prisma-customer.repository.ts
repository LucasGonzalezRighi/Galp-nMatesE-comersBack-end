import { Inject, Injectable } from '@nestjs/common'

import type { Prisma } from '../../../generated/prisma/client'
import { CLOCK, type Clock } from '../../../shared/domain/clock'
import { createDomainEvent } from '../../../shared/domain/domain-event'
import { OutboxRepository } from '../../../shared/infrastructure/outbox/outbox.repository'
import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service'
import type {
  CustomerPatch,
  CustomerRepository,
  NewCustomer,
} from '../application/ports/customer.repository.port'
import type { NewUser } from '../application/ports/user.repository.port'
import type { Customer } from '../domain/customer.entity'
import { customerRegisteredEvent } from '../domain/identity-events'
import { toCustomer, translateEmailTaken } from './identity.mapper'

/**
 * Clientes con Prisma (Postgres): con cuenta o invitados. El email es `citext`; hay un solo
 * invitado por email (índice único parcial `customers_guest_email_key`) y una sola cuenta (la
 * unicidad de `users.email`), y los dos pueden convivir.
 */
@Injectable()
export class PrismaCustomerRepository implements CustomerRepository {
  /**
   * @param prisma - Cliente de Prisma de la app.
   * @param outbox - Outbox, para el evento `customer.registered` del alta.
   * @param clock - Reloj (la fecha del evento).
   */
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** {@inheritDoc CustomerRepository.findByUserId} */
  async findByUserId(userId: string): Promise<Customer | null> {
    const row = await this.prisma.customer.findUnique({ where: { userId } })
    return row === null ? null : toCustomer(row)
  }

  /** {@inheritDoc CustomerRepository.findByEmail} */
  async findByEmail(email: string): Promise<Customer | null> {
    const row = await this.prisma.customer.findFirst({
      where: { email },
      orderBy: { userId: { sort: 'asc', nulls: 'last' } },
    })
    return row === null ? null : toCustomer(row)
  }

  /** {@inheritDoc CustomerRepository.findGuestByEmail} */
  async findGuestByEmail(email: string): Promise<Customer | null> {
    const row = await this.prisma.customer.findFirst({ where: { email, userId: null } })
    return row === null ? null : toCustomer(row)
  }

  /** {@inheritDoc CustomerRepository.create} */
  async create(input: NewCustomer): Promise<Customer> {
    return toCustomer(await this.prisma.customer.create({ data: { ...input } }))
  }

  /**
   * {@inheritDoc CustomerRepository.createWithUser}
   *
   * Cliente con su usuario (un `INSERT` anidado) y el evento `customer.registered` en la misma
   * transacción.
   */
  async createWithUser(user: NewUser, customer: Omit<NewCustomer, 'userId'>): Promise<Customer> {
    const row = await translateEmailTaken(() =>
      this.prisma.$transaction(async (tx) => {
        const created = await tx.customer.create({
          data: { ...customer, user: { create: { ...user } } },
        })
        await this.outbox.append(
          tx,
          createDomainEvent(customerRegisteredEvent(created.id), this.clock.now()),
        )
        return created
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
