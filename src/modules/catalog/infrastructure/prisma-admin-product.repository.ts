import { Inject, Injectable } from '@nestjs/common'

import { Prisma } from '../../../generated/prisma/client'
import { CACHE_PORT, type CachePort } from '../../../shared/application/ports/cache.port'
import { CLOCK, type Clock } from '../../../shared/domain/clock'
import { createDomainEvent, type NewDomainEvent } from '../../../shared/domain/domain-event'
import { OutboxRepository } from '../../../shared/infrastructure/outbox/outbox.repository'
import { isUniqueViolation } from '../../../shared/infrastructure/prisma/prisma-errors'
import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service'
import { searchableTextSql } from '../../../shared/infrastructure/prisma/search-text'
import { MEDIA_STORAGE, type MediaStorage } from '../../media/application/ports/media-storage.port'
import type { MediaImage } from '../../media/domain/media'
import { saveMediaAssets } from '../../media/infrastructure/media-storage'
import type { ProductGroup } from '../domain/category.entity'
import { publishedAtAfterSave } from '../domain/catalog-admin-events'
import type { TabsOverride } from '../domain/product.entity'
import type {
  AdminProductFilter,
  AdminProductList,
  AdminProductRecord,
  AdminProductRepository,
  ProductWrite,
  ProductWriteOutcome,
} from '../application/ports/admin-product.repository.port'
import { ADMIN_PRODUCT_INCLUDE, toAdminProductRecord } from './admin-product.mapper'
import { bumpCatalogCacheVersion } from './catalog-cache'
import { ORDER_BY } from './prisma-product.repository'

/** UUID de cualquier versión (las del seed son v7): los ids que no lo son no existen. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Postgres no guarda el carácter NUL en un `text`: un filtro con NUL no coincide con nada. */
const NUL = '\u0000'

/** Clave del lock de transacción que serializa los cambios de slug de los productos (B-81). */
const PRODUCT_SLUG_LOCK = 'catalog:product-slug'

/**
 * Código visible en SQL, igual a `formatProductCode` ("N°07", "N°100"): sin `lpad`, que corta a
 * dos caracteres desde el 100.
 */
const PRODUCT_CODE_SQL = Prisma.sql`'N°' || CASE WHEN p.sequence < 10 THEN '0' ELSE '' END || p.sequence::text`

/**
 * Texto donde busca el dashboard, normalizado igual que `normalizeSearchText`: el nombre y el
 * código unidos con un espacio (`matchesSearch(q, [name, code])` del mock).
 */
const SEARCH_TEXT = searchableTextSql(Prisma.sql`p.name || ' ' || ${PRODUCT_CODE_SQL}`)

/** Orden por defecto del listado del dashboard: por código. */
const BY_SEQUENCE = Prisma.sql`p.sequence ASC`

/**
 * `WHERE` del listado del dashboard. Sin estado excluye los archivados; `stockOut` mira lo
 * disponible (sin fila de `inventory`, 0; Ruling B-71).
 *
 * @returns Las condiciones, o `null` si un filtro de texto no deja ninguna fila posible.
 */
function adminWhere(filter: AdminProductFilter): Prisma.Sql | null {
  if (filter.search?.includes(NUL) === true || filter.categorySlug?.includes(NUL) === true) {
    return null
  }
  const conditions = [
    filter.status === null
      ? Prisma.sql`p.status <> 'archived'`
      : Prisma.sql`p.status = ${filter.status}::product_status`,
  ]
  if (filter.stockOut) conditions.push(Prisma.sql`COALESCE(i.on_hand - i.reserved, 0) <= 0`)
  if (filter.categorySlug !== null) conditions.push(Prisma.sql`c.slug = ${filter.categorySlug}`)
  if (filter.search !== null) {
    conditions.push(Prisma.sql`strpos(${SEARCH_TEXT}, ${filter.search}) > 0`)
  }
  return Prisma.join(conditions, ' AND ')
}

/** `tabs_override` como se guarda: sin los textos en `null`, o `NULL` si no queda ninguno. */
function tabsOverrideJson(
  override: TabsOverride | null,
): Prisma.InputJsonObject | typeof Prisma.DbNull {
  const json: Prisma.InputJsonObject = {
    ...(override?.materials == null ? {} : { materials: override.materials }),
    ...(override?.care == null ? {} : { care: override.care }),
  }
  return Object.keys(json).length === 0 ? Prisma.DbNull : json
}

/** Columnas de `products` que escribe el formulario. */
function columnsOf(product: ProductWrite) {
  return {
    slug: product.slug,
    categoryId: product.categoryId,
    name: product.name,
    description: product.description,
    priceArs: product.priceArs,
    status: product.status,
    featured: product.featured,
    tabsOverride: tabsOverrideJson(product.tabsOverride),
    leathers: [...product.leathers],
  }
}

/** Toma el lock de transacción de los slugs de productos (se suelta con el commit). */
async function lockProductSlugs(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${PRODUCT_SLUG_LOCK}))`
}

/**
 * Indica si otro producto usa el slug, como actual o como anterior (el propio producto puede
 * volver a uno suyo).
 */
async function slugTaken(
  tx: Prisma.TransactionClient,
  slug: string,
  ownId: string | null,
): Promise<boolean> {
  const current = await tx.product.count({
    where: ownId === null ? { slug } : { slug, id: { not: ownId } },
  })
  if (current > 0) return true
  const previous = await tx.productSlugHistory.count({
    where: ownId === null ? { slug } : { slug, productId: { not: ownId } },
  })
  return previous > 0
}

/**
 * Productos del dashboard con Prisma (Postgres), en cualquier estado y sin caché.
 *
 * - Listado: filtros, búsqueda (nombre + código, sin acentos) y orden en SQL, como el mock.
 * - Slugs: cada alta o edición toma `pg_advisory_xact_lock(hashtext('catalog:product-slug'))` y
 *   compara contra los slugs actuales y el historial de los demás productos; si cambia, el
 *   anterior pasa al historial (y el nuevo sale del historial propio). `P2002` → `slug_taken`.
 * - `expectedUpdatedAt`: se lee el producto con `FOR UPDATE` y se compara al milisegundo en la
 *   misma transacción, antes que el slug.
 * - Stock (Ruling B-71): el alta crea `inventory` con `on_hand = stock`; la edición escribe
 *   `on_hand = stock + reserved` (nunca rompe `inventory_reserved_check`).
 * - Fotos: se buscan o se crean en `media_assets` por `publicId` y cada uso guarda su `alt`.
 * - Cada escritura guarda su `storefront.stale` en la misma transacción y, después del commit,
 *   sube la versión de la caché del catálogo (Ruling B-72).
 */
@Injectable()
export class PrismaAdminProductRepository implements AdminProductRepository {
  /**
   * @param prisma - Cliente de Prisma de la app.
   * @param outbox - Outbox (el aviso va en la transacción de la escritura).
   * @param cache - Caché (versión del catálogo).
   * @param clock - Reloj (`publishedAt`, historial y fecha del evento).
   * @param media - Proveedor de las fotos nuevas.
   */
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxRepository,
    @Inject(CACHE_PORT) private readonly cache: CachePort,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(MEDIA_STORAGE) private readonly media: MediaStorage,
  ) {}

  /** {@inheritDoc AdminProductRepository.list} */
  async list(filter: AdminProductFilter): Promise<AdminProductList> {
    const where = adminWhere(filter)
    if (where === null) return { items: [], total: 0 }
    const order = filter.sort === null ? BY_SEQUENCE : ORDER_BY[filter.sort]
    const offset = (filter.page - 1) * filter.pageSize
    const [counts, page] = await Promise.all([
      this.prisma.$queryRaw<{ total: number }[]>`
        SELECT count(*)::int AS total
        FROM products p
        JOIN categories c ON c.id = p.category_id
        LEFT JOIN inventory i ON i.product_id = p.id
        WHERE ${where}`,
      Number.isSafeInteger(offset)
        ? this.prisma.$queryRaw<{ id: string }[]>`
            SELECT p.id
            FROM products p
            JOIN categories c ON c.id = p.category_id
            LEFT JOIN inventory i ON i.product_id = p.id
            WHERE ${where}
            ORDER BY ${order}
            LIMIT ${filter.pageSize}::int OFFSET ${offset}::bigint`
        : Promise.resolve<{ id: string }[]>([]),
    ])
    const ids = page.map(({ id }) => id)
    const rows =
      ids.length === 0
        ? []
        : await this.prisma.product.findMany({
            where: { id: { in: ids } },
            include: ADMIN_PRODUCT_INCLUDE,
          })
    const byId = new Map(rows.map((row) => [row.id, row]))
    const items = ids.flatMap((id) => {
      const row = byId.get(id)
      return row === undefined ? [] : [toAdminProductRecord(row)]
    })
    return { items, total: counts[0]?.total ?? 0 }
  }

  /** {@inheritDoc AdminProductRepository.findById} */
  async findById(id: string): Promise<AdminProductRecord | null> {
    if (!UUID_PATTERN.test(id)) return null
    const row = await this.prisma.product.findUnique({
      where: { id },
      include: ADMIN_PRODUCT_INCLUDE,
    })
    return row === null ? null : toAdminProductRecord(row)
  }

  /** {@inheritDoc AdminProductRepository.findCategoryGroup} */
  async findCategoryGroup(categoryId: string): Promise<ProductGroup | null> {
    if (!UUID_PATTERN.test(categoryId)) return null
    const row = await this.prisma.category.findUnique({
      where: { id: categoryId },
      select: { group: true },
    })
    return row?.group ?? null
  }

  /** {@inheritDoc AdminProductRepository.create} */
  async create(product: ProductWrite, event: NewDomainEvent): Promise<ProductWriteOutcome> {
    const now = this.clock.now()
    let id: string | null
    try {
      id = await this.prisma.$transaction(async (tx) => {
        await lockProductSlugs(tx)
        if (await slugTaken(tx, product.slug, null)) return null
        const created = await tx.product.create({
          data: {
            ...columnsOf(product),
            publishedAt: publishedAtAfterSave(null, product.status, now),
          },
          select: { id: true },
        })
        await tx.inventory.create({ data: { productId: created.id, onHand: product.stock } })
        await this.writeImages(tx, created.id, product.images)
        await this.outbox.append(tx, createDomainEvent(event, now))
        return created.id
      })
    } catch (error) {
      if (isUniqueViolation(error)) return { kind: 'slug_taken' }
      throw error
    }
    if (id === null) return { kind: 'slug_taken' }
    return this.saved(id)
  }

  /** {@inheritDoc AdminProductRepository.update} */
  async update(
    id: string,
    product: ProductWrite,
    expectedUpdatedAt: Date | null,
    event: NewDomainEvent,
  ): Promise<ProductWriteOutcome> {
    if (!UUID_PATTERN.test(id)) return { kind: 'not_found' }
    const now = this.clock.now()
    let outcome: Exclude<ProductWriteOutcome['kind'], 'saved'> | null
    try {
      outcome = await this.prisma.$transaction(async (tx) => {
        await lockProductSlugs(tx)
        const [current] = await tx.$queryRaw<
          { slug: string; published_at: Date | null; updated_at: Date }[]
        >`SELECT slug, published_at, updated_at FROM products WHERE id = ${id}::uuid FOR UPDATE`
        if (current === undefined) return 'not_found'
        if (
          expectedUpdatedAt !== null &&
          current.updated_at.getTime() !== expectedUpdatedAt.getTime()
        ) {
          return 'changed'
        }
        if (await slugTaken(tx, product.slug, id)) return 'slug_taken'
        if (current.slug !== product.slug) {
          await tx.productSlugHistory.deleteMany({ where: { slug: product.slug, productId: id } })
          await tx.productSlugHistory.upsert({
            where: { slug: current.slug },
            create: { slug: current.slug, productId: id, createdAt: now },
            update: { productId: id, createdAt: now },
          })
        }
        await tx.product.update({
          where: { id },
          data: {
            ...columnsOf(product),
            publishedAt: publishedAtAfterSave(current.published_at, product.status, now),
          },
          select: { id: true },
        })
        await tx.$executeRaw`
          INSERT INTO inventory (product_id, on_hand) VALUES (${id}::uuid, ${product.stock})
          ON CONFLICT (product_id) DO UPDATE
          SET on_hand = ${product.stock} + inventory.reserved,
              version = inventory.version + 1,
              updated_at = now()`
        await this.writeImages(tx, id, product.images)
        await this.outbox.append(tx, createDomainEvent(event, now))
        return null
      })
    } catch (error) {
      if (isUniqueViolation(error)) return { kind: 'slug_taken' }
      throw error
    }
    if (outcome !== null) return { kind: outcome }
    return this.saved(id)
  }

  /** {@inheritDoc AdminProductRepository.archive} */
  async archive(id: string, event: NewDomainEvent): Promise<AdminProductRecord | null> {
    if (!UUID_PATTERN.test(id)) return null
    const found = await this.prisma.$transaction(async (tx) => {
      const [current] = await tx.$queryRaw<{ status: string }[]>`
        SELECT status::text AS status FROM products WHERE id = ${id}::uuid FOR UPDATE`
      if (current === undefined) return false
      if (current.status !== 'archived') {
        await tx.product.update({
          where: { id },
          data: { status: 'archived' },
          select: { id: true },
        })
      }
      await this.outbox.append(tx, createDomainEvent(event, this.clock.now()))
      return true
    })
    if (!found) return null
    await bumpCatalogCacheVersion(this.cache)
    return this.findById(id)
  }

  /**
   * Reemplaza las fotos del producto: busca o crea cada una en `media_assets` y guarda su lugar y
   * su `alt` en `product_images`.
   */
  private async writeImages(
    tx: Prisma.TransactionClient,
    productId: string,
    images: readonly MediaImage[],
  ): Promise<void> {
    await tx.productImage.deleteMany({ where: { productId } })
    if (images.length === 0) return
    const assets = await saveMediaAssets(tx, images, this.media.provider)
    await tx.productImage.createMany({
      data: images.map((image, index) => {
        const mediaAssetId = assets.get(image.publicId)
        if (mediaAssetId === undefined) {
          throw new Error(`La foto ${image.publicId} no quedó guardada en media_assets.`)
        }
        return { productId, position: index + 1, mediaAssetId, alt: image.alt }
      }),
    })
  }

  /**
   * Después del commit: sube la versión de la caché del catálogo y lee el producto guardado
   * (fuera de la transacción: las relaciones anidadas dentro de ella mandan consultas en paralelo
   * por la misma conexión).
   */
  private async saved(id: string): Promise<ProductWriteOutcome> {
    await bumpCatalogCacheVersion(this.cache)
    const record = await this.findById(id)
    if (record === null) throw new Error(`El producto ${id} no está después de guardarlo.`)
    return { kind: 'saved', record }
  }
}
