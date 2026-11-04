import { Inject, Injectable } from '@nestjs/common'

import { CACHE_PORT, type CachePort } from '../../../shared/application/ports/cache.port'
import { CLOCK, type Clock } from '../../../shared/domain/clock'
import { createDomainEvent, type NewDomainEvent } from '../../../shared/domain/domain-event'
import { OutboxRepository } from '../../../shared/infrastructure/outbox/outbox.repository'
import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service'
import { bumpCatalogCacheVersion } from '../../catalog/infrastructure/catalog-cache'
import type {
  ModeratedReview,
  NewReview,
  ReviewPatch,
  ReviewStatus,
} from '../domain/review-moderation'
import { createProductReview } from '../domain/review.entity'
import type {
  ModeratedReviewSlice,
  ReviewModerationRepository,
} from '../application/ports/review-moderation.repository.port'

/** Un UUID de cualquier versión (las del seed son v5): los que no lo son no existen. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** De la más nueva a la más vieja; el id desempata. */
const NEWEST_FIRST = [{ createdAt: 'desc' }, { id: 'desc' }] as const

/** Columnas de `reviews` y del producto que ve el dashboard. */
const MODERATED_SELECT = {
  id: true,
  productId: true,
  authorName: true,
  rating: true,
  text: true,
  createdAt: true,
  verifiedPurchase: true,
  status: true,
  featured: true,
  moderatedAt: true,
  product: { select: { slug: true, name: true } },
} as const

/** Fila de `reviews` con las columnas de {@link MODERATED_SELECT}. */
interface ModeratedRow {
  id: string
  productId: string
  authorName: string
  rating: { toNumber(): number }
  text: string
  createdAt: Date
  verifiedPurchase: boolean
  status: ReviewStatus
  featured: boolean
  moderatedAt: Date | null
  product: { slug: string; name: string }
}

/** Pasa una fila a la reseña del dominio (el `Decimal` de `rating` a `number`). */
function toModeratedReview(row: ModeratedRow): ModeratedReview {
  const { status, featured, moderatedAt, product, ...review } = row
  return {
    ...createProductReview({ ...review, rating: review.rating.toNumber() }),
    status,
    featured,
    moderatedAt,
    product: { slug: product.slug, name: product.name },
  }
}

/**
 * Reseñas en cualquier estado con Prisma (Postgres): el envío de los visitantes y la moderación
 * del dashboard. El slug y el nombre del producto se leen con la relación de Prisma (lectura de
 * solo lectura sobre `products`, ADR 0001). Cada moderación escribe el aviso a la tienda en la
 * misma transacción y, después del commit, sube la versión de la caché del catálogo (el promedio
 * de los listados y de la ficha cambia; Ruling B-77).
 */
@Injectable()
export class PrismaReviewModerationRepository implements ReviewModerationRepository {
  /**
   * @param prisma - Cliente de Prisma de la app.
   * @param outbox - Outbox (en la transacción de la moderación).
   * @param cache - Caché (versión del catálogo).
   * @param clock - Reloj (fecha del evento).
   */
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxRepository,
    @Inject(CACHE_PORT) private readonly cache: CachePort,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** {@inheritDoc ReviewModerationRepository.submit} */
  async submit(review: NewReview): Promise<void> {
    await this.prisma.review.create({
      data: {
        productId: review.productId,
        authorName: review.authorName,
        rating: review.rating,
        text: review.text,
        status: 'pending',
        featured: false,
        verifiedPurchase: false,
      },
      select: { id: true },
    })
  }

  /** {@inheritDoc ReviewModerationRepository.list} */
  async list(
    status: ReviewStatus | undefined,
    page: number,
    pageSize: number,
  ): Promise<ModeratedReviewSlice> {
    const where = status === undefined ? {} : { status }
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.review.findMany({
        where,
        orderBy: [...NEWEST_FIRST],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: MODERATED_SELECT,
      }),
      this.prisma.review.count({ where }),
    ])
    return { items: rows.map(toModeratedReview), total }
  }

  /** {@inheritDoc ReviewModerationRepository.findById} */
  async findById(id: string): Promise<ModeratedReview | null> {
    if (!UUID_PATTERN.test(id)) return null
    const row = await this.prisma.review.findUnique({ where: { id }, select: MODERATED_SELECT })
    return row === null ? null : toModeratedReview(row)
  }

  /**
   * {@inheritDoc ReviewModerationRepository.update}
   *
   * Bloquea la fila con `SELECT … FOR UPDATE` antes de decidir: otra moderación de la misma
   * reseña espera al commit de esta y decide con el estado que dejó.
   */
  async update(
    id: string,
    decide: (current: Pick<ModeratedReview, 'status'>) => ReviewPatch,
    event: NewDomainEvent,
  ): Promise<ModeratedReview | null> {
    if (!UUID_PATTERN.test(id)) return null
    const row = await this.prisma.$transaction(async (tx) => {
      const [locked] = await tx.$queryRaw<{ status: ReviewStatus }[]>`
        SELECT status::text AS status FROM reviews WHERE id = ${id}::uuid FOR UPDATE`
      if (locked === undefined) return null
      const updated = await tx.review.update({
        where: { id },
        data: decide({ status: locked.status }),
        select: MODERATED_SELECT,
      })
      await this.outbox.append(tx, createDomainEvent(event, this.clock.now()))
      return updated
    })
    if (row === null) return null
    await bumpCatalogCacheVersion(this.cache)
    return toModeratedReview(row)
  }
}
