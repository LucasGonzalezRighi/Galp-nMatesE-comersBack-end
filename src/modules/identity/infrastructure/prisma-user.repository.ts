import { Injectable } from '@nestjs/common'

import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service'
import type { NewUser, UserRepository } from '../application/ports/user.repository.port'
import type { User } from '../domain/user.entity'
import { toUser, translateEmailTaken } from './identity.mapper'

/** Usuarios con Prisma (Postgres): el email es `citext`, así que la unicidad ignora mayúsculas. */
@Injectable()
export class PrismaUserRepository implements UserRepository {
  /** @param prisma - Cliente de Prisma de la app. */
  constructor(private readonly prisma: PrismaService) {}

  /** {@inheritDoc UserRepository.findByEmail} */
  async findByEmail(email: string): Promise<User | null> {
    const row = await this.prisma.user.findUnique({ where: { email } })
    return row === null ? null : toUser(row)
  }

  /** {@inheritDoc UserRepository.findById} */
  async findById(id: string): Promise<User | null> {
    const row = await this.prisma.user.findUnique({ where: { id } })
    return row === null ? null : toUser(row)
  }

  /** {@inheritDoc UserRepository.create} */
  async create(input: NewUser): Promise<User> {
    const row = await translateEmailTaken(() => this.prisma.user.create({ data: { ...input } }))
    return toUser(row)
  }

  /** {@inheritDoc UserRepository.updatePassword} */
  async updatePassword(id: string, passwordHash: string): Promise<void> {
    await this.prisma.user.update({ where: { id }, data: { passwordHash } })
  }

  /** {@inheritDoc UserRepository.touchLastLogin} */
  async touchLastLogin(id: string, at: Date): Promise<void> {
    await this.prisma.user.update({ where: { id }, data: { lastLoginAt: at } })
  }
}
