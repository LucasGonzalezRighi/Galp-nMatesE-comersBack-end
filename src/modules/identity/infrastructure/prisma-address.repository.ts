import { Injectable } from '@nestjs/common'

import type { Prisma } from '../../../generated/prisma/client'
import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service'
import type { AddressRepository, NewAddress } from '../application/ports/address.repository.port'
import type { Address, AddressInput } from '../domain/address.entity'
import { isUniqueViolation, toAddress, toAddressData } from './identity.mapper'

/** Orden de la libreta: la predeterminada primero y después por alta (los ids son UUID v7). */
const ADDRESS_ORDER = [
  { isDefault: 'desc' },
  { createdAt: 'asc' },
  { id: 'asc' },
] satisfies Prisma.AddressOrderByWithRelationInput[]

/**
 * Libreta de direcciones con Prisma (Postgres). La base garantiza una sola predeterminada por
 * cliente con un índice único parcial (`addresses_default_per_customer_idx`); al escribir una
 * predeterminada, la transacción primero le quita la marca a la anterior. Si otra escritura
 * simultánea ganó la carrera y el índice rechaza la fila (`P2002`), se reintenta una vez.
 */
@Injectable()
export class PrismaAddressRepository implements AddressRepository {
  /** @param prisma - Cliente de Prisma de la app. */
  constructor(private readonly prisma: PrismaService) {}

  /** {@inheritDoc AddressRepository.listByCustomer} */
  async listByCustomer(customerId: string): Promise<Address[]> {
    const rows = await this.prisma.address.findMany({
      where: { customerId },
      orderBy: ADDRESS_ORDER,
    })
    return rows.map(toAddress)
  }

  /** {@inheritDoc AddressRepository.findOne} */
  async findOne(customerId: string, id: string): Promise<Address | null> {
    const row = await this.prisma.address.findFirst({ where: { id, customerId } })
    return row === null ? null : toAddress(row)
  }

  /** {@inheritDoc AddressRepository.create} */
  async create(input: NewAddress): Promise<Address> {
    const row = await retryOnceOnUniqueViolation(() =>
      this.prisma.$transaction(async (tx) => {
        if (input.isDefault) await clearDefault(tx, input.customerId)
        return tx.address.create({
          data: { id: input.id, customerId: input.customerId, ...toAddressData(input) },
        })
      }),
    )
    return toAddress(row)
  }

  /** {@inheritDoc AddressRepository.replace} */
  async replace(id: string, input: AddressInput): Promise<Address> {
    const row = await retryOnceOnUniqueViolation(() =>
      this.prisma.$transaction(async (tx) => {
        if (input.isDefault) {
          const { customerId } = await tx.address.findUniqueOrThrow({
            where: { id },
            select: { customerId: true },
          })
          await clearDefault(tx, customerId, id)
        }
        return tx.address.update({ where: { id }, data: toAddressData(input) })
      }),
    )
    return toAddress(row)
  }

  /** {@inheritDoc AddressRepository.delete} */
  async delete(id: string): Promise<void> {
    await this.prisma.address.deleteMany({ where: { id } })
  }
}

/** Le quita la marca de predeterminada a las direcciones del cliente (menos `exceptId`). */
async function clearDefault(
  tx: Prisma.TransactionClient,
  customerId: string,
  exceptId?: string,
): Promise<void> {
  await tx.address.updateMany({
    where: {
      customerId,
      isDefault: true,
      ...(exceptId === undefined ? {} : { id: { not: exceptId } }),
    },
    data: { isDefault: false },
  })
}

/** Corre la escritura y, si el índice de la predeterminada la rechaza, la repite una vez. */
async function retryOnceOnUniqueViolation<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write()
  } catch (error) {
    if (!isUniqueViolation(error)) throw error
    return write()
  }
}
