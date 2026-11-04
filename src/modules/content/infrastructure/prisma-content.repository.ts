import { Inject, Injectable } from '@nestjs/common'

import { CLOCK, type Clock } from '../../../shared/domain/clock'
import { createDomainEvent, type JsonObject } from '../../../shared/domain/domain-event'
import { OutboxRepository } from '../../../shared/infrastructure/outbox/outbox.repository'
import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service'
import type { ContentKey } from '../domain/content-key'
import type { ContentRepository, ContentWrite } from '../application/ports/content.repository.port'

/** `content_blocks` con Prisma (Postgres), sin caché. */
@Injectable()
export class PrismaContentRepository implements ContentRepository {
  /**
   * @param prisma - Cliente de Prisma de la app.
   * @param outbox - Outbox (el aviso a la tienda va en la transacción de cada guardado).
   * @param clock - Reloj (`occurred_at` del evento).
   */
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** {@inheritDoc ContentRepository.find} */
  async find(key: ContentKey): Promise<unknown> {
    const block = await this.prisma.contentBlock.findUnique({
      where: { key },
      select: { data: true },
    })
    return block?.data ?? null
  }

  /** {@inheritDoc ContentRepository.save} */
  async save(key: ContentKey, data: JsonObject, write: ContentWrite): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.contentBlock.upsert({
        where: { key },
        create: { key, data, updatedBy: write.updatedBy },
        update: { data, version: { increment: 1 }, updatedBy: write.updatedBy },
        select: { key: true },
      })
      await this.outbox.append(tx, createDomainEvent(write.event, this.clock.now()))
    })
  }
}
