import { Injectable } from '@nestjs/common'

import { Prisma } from '../../../generated/prisma/client'
import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service'
import type { ProductGroup } from '../domain/category.entity'
import { normalizeSearchText } from '../domain/search-text'
import type { Product } from '../domain/product.entity'
import type {
  ProductFilter,
  ProductList,
  ProductRepository,
} from '../application/ports/product.repository.port'
import type { ProductSortOrder } from '../application/read-models'
import { PRODUCT_INCLUDE, toProduct } from './product.mapper'

/** Letras con acento que la búsqueda iguala a su letra base (`translate` de Postgres). */
const ACCENTED = 'ÁÀÂÄÃÉÈÊËÍÌÎÏÓÒÔÖÕÚÙÛÜÑÇáàâäãéèêëíìîïóòôöõúùûüñç'

/** Cada letra de {@link ACCENTED} sin acento y en minúscula, en el mismo orden. */
const UNACCENTED = ACCENTED.replace(/./gu, (letter) => normalizeSearchText(letter))

/** UUID de cualquier versión: los ids que no lo son no pueden estar en `products.id`. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Texto donde se busca, normalizado en SQL igual que `normalizeSearchText`: nombre, descripción y
 * línea unidos con espacios, sin acentos, en minúsculas y con los espacios colapsados.
 */
const SEARCH_TEXT = Prisma.sql`regexp_replace(lower(translate(p.name || ' ' || p.description || ' ' || c.name, ${ACCENTED}, ${UNACCENTED})), ${'\\s+'}, ' ', 'g')`

/**
 * Orden de cada criterio, desempatado por código como el front. Los "a consultar" (`NULL`) van
 * al final en los dos órdenes por precio; A-Z usa la intercalación española de ICU.
 */
const ORDER_BY: Record<ProductSortOrder, Prisma.Sql> = {
  destacados: Prisma.sql`p.featured DESC, p.sequence ASC`,
  menor: Prisma.sql`p.price_ars ASC NULLS LAST, p.sequence ASC`,
  mayor: Prisma.sql`p.price_ars DESC NULLS LAST, p.sequence ASC`,
  az: Prisma.sql`p.name COLLATE "es-x-icu" ASC, p.sequence ASC`,
}

/**
 * Arma el `WHERE` del listado (siempre solo publicados).
 *
 * @returns Las condiciones, o `null` si el filtro de ids no deja ningún id posible.
 */
function whereClause(filter: ProductFilter): Prisma.Sql | null {
  const conditions = [Prisma.sql`p.status = 'published'`]
  if (filter.category !== undefined) conditions.push(Prisma.sql`c.slug = ${filter.category}`)
  if (filter.group !== undefined) {
    conditions.push(Prisma.sql`c."group" = ${filter.group}::product_group`)
  }
  if (filter.ids !== undefined) {
    const ids = filter.ids.filter((id) => UUID_PATTERN.test(id))
    if (ids.length === 0) return null
    conditions.push(Prisma.sql`p.id = ANY(${ids}::uuid[])`)
  }
  if (filter.featured === true) conditions.push(Prisma.sql`p.featured`)
  if (filter.q !== undefined) conditions.push(Prisma.sql`strpos(${SEARCH_TEXT}, ${filter.q}) > 0`)
  return Prisma.join(conditions, ' AND ')
}

/** Lecturas de productos publicados con Prisma (Postgres). */
@Injectable()
export class PrismaProductRepository implements ProductRepository {
  /** @param prisma - Cliente de Prisma de la app. */
  constructor(private readonly prisma: PrismaService) {}

  /**
   * {@inheritDoc ProductRepository.list}
   *
   * Filtra, ordena y pagina en SQL (búsqueda sin acentos e intercalación española) y después lee
   * los productos de la página con sus relaciones.
   */
  async list(filter: ProductFilter): Promise<ProductList> {
    const where = whereClause(filter)
    if (where === null) return { items: [], total: 0 }
    const offset = (filter.page - 1) * filter.pageSize
    const [counts, page] = await Promise.all([
      this.prisma.$queryRaw<{ total: number }[]>`
        SELECT count(*)::int AS total
        FROM products p JOIN categories c ON c.id = p.category_id
        WHERE ${where}`,
      this.prisma.$queryRaw<{ id: string }[]>`
        SELECT p.id
        FROM products p JOIN categories c ON c.id = p.category_id
        WHERE ${where}
        ORDER BY ${ORDER_BY[filter.sort]}
        LIMIT ${filter.pageSize}::int OFFSET ${offset}::int`,
    ])
    const ids = page.map(({ id }) => id)
    const rows =
      ids.length === 0
        ? []
        : await this.prisma.product.findMany({
            where: { id: { in: ids } },
            include: PRODUCT_INCLUDE,
          })
    const byId = new Map(rows.map((row) => [row.id, row]))
    const items = ids.flatMap((id) => {
      const row = byId.get(id)
      return row === undefined ? [] : [toProduct(row)]
    })
    return { items, total: counts[0]?.total ?? 0 }
  }

  /** {@inheritDoc ProductRepository.findBySlug} */
  async findBySlug(slug: string): Promise<Product | null> {
    const current = await this.prisma.product.findFirst({
      where: { slug, status: 'published' },
      include: PRODUCT_INCLUDE,
    })
    if (current !== null) return toProduct(current)
    const renamed = await this.prisma.product.findFirst({
      where: { status: 'published', slugHistory: { some: { slug } } },
      include: PRODUCT_INCLUDE,
    })
    return renamed === null ? null : toProduct(renamed)
  }

  /** {@inheritDoc ProductRepository.listPublishedByGroup} */
  async listPublishedByGroup(group: ProductGroup): Promise<Product[]> {
    const rows = await this.prisma.product.findMany({
      where: { status: 'published', category: { group } },
      orderBy: { sequence: 'asc' },
      include: PRODUCT_INCLUDE,
    })
    return rows.map(toProduct)
  }
}
