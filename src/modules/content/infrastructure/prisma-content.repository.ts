import { Injectable } from '@nestjs/common'

import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service'
import type { ContentKey } from '../domain/content-key'
import type { ContentRepository } from '../application/ports/content.repository.port'

/** Lecturas de `content_blocks` con Prisma (Postgres). */
@Injectable()
export class PrismaContentRepository implements ContentRepository {
  /** @param prisma - Cliente de Prisma de la app. */
  constructor(private readonly prisma: PrismaService) {}

  /** {@inheritDoc ContentRepository.find} */
  async find(key: ContentKey): Promise<unknown> {
    const block = await this.prisma.contentBlock.findUnique({
      where: { key },
      select: { data: true },
    })
    return block?.data ?? null
  }
}
