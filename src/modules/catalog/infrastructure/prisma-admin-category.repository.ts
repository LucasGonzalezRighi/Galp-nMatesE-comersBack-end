import { Inject, Injectable } from '@nestjs/common'

import { Prisma } from '../../../generated/prisma/client'
import { CACHE_PORT, type CachePort } from '../../../shared/application/ports/cache.port'
import { CLOCK, type Clock } from '../../../shared/domain/clock'
import { createDomainEvent, type NewDomainEvent } from '../../../shared/domain/domain-event'
import { OutboxRepository } from '../../../shared/infrastructure/outbox/outbox.repository'
import { isUniqueViolation } from '../../../shared/infrastructure/prisma/prisma-errors'
import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service'
import { MEDIA_STORAGE, type MediaStorage } from '../../media/application/ports/media-storage.port'
import { saveMediaAssets } from '../../media/infrastructure/media-storage'
import type {
  AdminCategoryRepository,
  CategoryDeleteOutcome,
  CategoryWrite,
  CategoryWriteOutcome,
} from '../application/ports/admin-category.repository.port'
import type { CategoryListing } from '../application/ports/category.repository.port'
import { bumpCatalogCacheVersion } from './catalog-cache'
import { CATEGORY_INCLUDE, toCategoryListing } from './category.mapper'

/** UUID de cualquier versión: los ids que no lo son no existen. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Indica si Postgres rechazó la escritura por una clave foránea (`P2003`). */
function isForeignKeyViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003'
}

/** Resultado de una escritura dentro de la transacción: el id guardado o por qué no se guardó. */
type TxOutcome = { kind: 'saved'; id: string } | Exclude<CategoryWriteOutcome, { kind: 'saved' }>

/**
 * Líneas del dashboard con Prisma (Postgres), sin caché. La unicidad del slug es entre líneas
 * (`categories_slug_key`; `P2002` → `slug_taken`). Cada escritura toma la fila de la línea con
 * `FOR UPDATE` (así un alta de producto en esa línea espera y el conteo de productos no tiene
 * carrera), guarda su `storefront.stale` en la misma transacción y, después del commit, sube la
 * versión de la caché del catálogo (Ruling B-72).
 */
@Injectable()
export class PrismaAdminCategoryRepository implements AdminCategoryRepository {
  /**
   * @param prisma - Cliente de Prisma de la app.
   * @param outbox - Outbox (el aviso va en la transacción de la escritura).
   * @param cache - Caché (versión del catálogo).
   * @param clock - Reloj (fecha del evento).
   * @param media - Proveedor de las fotos nuevas.
   */
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxRepository,
    @Inject(CACHE_PORT) private readonly cache: CachePort,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(MEDIA_STORAGE) private readonly media: MediaStorage,
  ) {}

  /** {@inheritDoc AdminCategoryRepository.list} */
  async list(): Promise<CategoryListing[]> {
    const rows = await this.prisma.category.findMany({
      orderBy: { position: 'asc' },
      include: CATEGORY_INCLUDE,
    })
    return rows.map(toCategoryListing)
  }

  /** {@inheritDoc AdminCategoryRepository.findById} */
  async findById(id: string): Promise<CategoryListing | null> {
    if (!UUID_PATTERN.test(id)) return null
    const row = await this.prisma.category.findUnique({ where: { id }, include: CATEGORY_INCLUDE })
    return row === null ? null : toCategoryListing(row)
  }

  /** {@inheritDoc AdminCategoryRepository.create} */
  async create(category: CategoryWrite, event: NewDomainEvent): Promise<CategoryWriteOutcome> {
    return this.write(async (tx) => {
      const other = await tx.category.findUnique({
        where: { slug: category.slug },
        select: { id: true },
      })
      if (other !== null) return { kind: 'slug_taken' }
      const { _max } = await tx.category.aggregate({ _max: { position: true } })
      const created = await tx.category.create({
        data: {
          ...(await this.columnsOf(tx, category)),
          position: (_max.position ?? 0) + 1,
        },
        select: { id: true },
      })
      await this.outbox.append(tx, createDomainEvent(event, this.clock.now()))
      return { kind: 'saved', id: created.id }
    })
  }

  /** {@inheritDoc AdminCategoryRepository.update} */
  async update(
    id: string,
    category: CategoryWrite,
    event: NewDomainEvent,
  ): Promise<CategoryWriteOutcome> {
    if (!UUID_PATTERN.test(id)) return { kind: 'not_found' }
    return this.write(async (tx) => {
      const [current] = await tx.$queryRaw<{ group: string }[]>`
        SELECT "group"::text AS "group" FROM categories WHERE id = ${id}::uuid FOR UPDATE`
      if (current === undefined) return { kind: 'not_found' }
      if (
        current.group !== category.group &&
        (await tx.product.count({ where: { categoryId: id } })) > 0
      ) {
        return { kind: 'group_locked' }
      }
      const other = await tx.category.findFirst({
        where: { slug: category.slug, id: { not: id } },
        select: { id: true },
      })
      if (other !== null) return { kind: 'slug_taken' }
      await tx.category.update({
        where: { id },
        data: await this.columnsOf(tx, category),
        select: { id: true },
      })
      await this.outbox.append(tx, createDomainEvent(event, this.clock.now()))
      return { kind: 'saved', id }
    })
  }

  /** {@inheritDoc AdminCategoryRepository.delete} */
  async delete(id: string, event: NewDomainEvent): Promise<CategoryDeleteOutcome> {
    if (!UUID_PATTERN.test(id)) return 'not_found'
    let outcome: CategoryDeleteOutcome
    try {
      outcome = await this.prisma.$transaction(async (tx) => {
        const [current] = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM categories WHERE id = ${id}::uuid FOR UPDATE`
        if (current === undefined) return 'not_found'
        if ((await tx.product.count({ where: { categoryId: id } })) > 0) return 'has_products'
        await tx.category.delete({ where: { id }, select: { id: true } })
        const rest = await tx.category.findMany({
          select: { id: true, position: true },
          orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
        })
        for (const [index, line] of rest.entries()) {
          if (line.position !== index + 1) {
            await tx.category.update({ where: { id: line.id }, data: { position: index + 1 } })
          }
        }
        await this.outbox.append(tx, createDomainEvent(event, this.clock.now()))
        return 'deleted'
      })
    } catch (error) {
      if (isForeignKeyViolation(error)) return 'has_products'
      throw error
    }
    if (outcome === 'deleted') await bumpCatalogCacheVersion(this.cache)
    return outcome
  }

  /** {@inheritDoc AdminCategoryRepository.listIds} */
  async listIds(): Promise<string[]> {
    const rows = await this.prisma.category.findMany({
      select: { id: true },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    })
    return rows.map(({ id }) => id)
  }

  /** {@inheritDoc AdminCategoryRepository.reorder} */
  async reorder(ids: readonly string[], event: NewDomainEvent): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      for (const [index, id] of ids.entries()) {
        if (!UUID_PATTERN.test(id)) continue
        await tx.category.updateMany({ where: { id }, data: { position: index + 1 } })
      }
      await this.outbox.append(tx, createDomainEvent(event, this.clock.now()))
    })
    await bumpCatalogCacheVersion(this.cache)
  }

  /** Columnas de `categories` de la línea; busca o crea su foto en `media_assets`. */
  private async columnsOf(tx: Prisma.TransactionClient, category: CategoryWrite) {
    const { image } = category
    const assets = image === null ? null : await saveMediaAssets(tx, [image], this.media.provider)
    return {
      slug: category.slug,
      name: category.name,
      group: category.group,
      blurb: category.blurb,
      imageId: image === null ? null : (assets?.get(image.publicId) ?? null),
      imageAlt: image?.alt ?? null,
    }
  }

  /**
   * Corre un alta o una edición en una transacción (`P2002` del slug → `slug_taken`) y, si
   * guardó, sube la versión de la caché y lee la línea después del commit.
   */
  private async write(
    run: (tx: Prisma.TransactionClient) => Promise<TxOutcome>,
  ): Promise<CategoryWriteOutcome> {
    let outcome: TxOutcome
    try {
      outcome = await this.prisma.$transaction(run)
    } catch (error) {
      if (isUniqueViolation(error)) return { kind: 'slug_taken' }
      throw error
    }
    if (outcome.kind !== 'saved') return outcome
    await bumpCatalogCacheVersion(this.cache)
    const listing = await this.findById(outcome.id)
    if (listing === null) throw new Error(`La línea ${outcome.id} no está después de guardarla.`)
    return { kind: 'saved', listing }
  }
}
