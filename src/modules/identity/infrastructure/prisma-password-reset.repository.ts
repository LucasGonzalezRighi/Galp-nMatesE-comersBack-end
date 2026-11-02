import { Injectable } from '@nestjs/common'

import { newId } from '../../../shared/domain/id'
import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service'
import type {
  NewPasswordResetToken,
  PasswordResetRepository,
} from '../application/ports/password-reset.repository.port'

/** Tokens de recuperación con Prisma (Postgres): solo su SHA-256, nunca el token en claro. */
@Injectable()
export class PrismaPasswordResetRepository implements PasswordResetRepository {
  /** @param prisma - Cliente de Prisma de la app. */
  constructor(private readonly prisma: PrismaService) {}

  /** {@inheritDoc PasswordResetRepository.create} */
  async create(input: NewPasswordResetToken): Promise<void> {
    await this.prisma.passwordResetToken.create({
      data: {
        id: newId(),
        userId: input.userId,
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt,
      },
    })
  }

  /**
   * {@inheritDoc PasswordResetRepository.consume}
   *
   * Un solo `UPDATE … WHERE used_at IS NULL AND expires_at > now`: de dos usos simultáneos, solo
   * uno lo marca.
   */
  async consume(tokenHash: string, now: Date): Promise<{ userId: string } | null> {
    const { count } = await this.prisma.passwordResetToken.updateMany({
      where: { tokenHash, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    })
    if (count !== 1) return null
    const row = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      select: { userId: true },
    })
    return row === null ? null : { userId: row.userId }
  }
}
