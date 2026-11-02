import type { Prisma } from '../../../generated/prisma/client'
import { createCategory } from '../domain/category.entity'
import type { CategoryListing } from '../application/ports/category.repository.port'

/** Relaciones que se leen con cada línea: su foto y la cantidad de productos publicados. */
export const CATEGORY_INCLUDE = {
  image: { select: { publicId: true, url: true, width: true, height: true, alt: true } },
  _count: { select: { products: { where: { status: 'published' } } } },
} satisfies Prisma.CategoryInclude

/** Fila de `categories` con las relaciones de {@link CATEGORY_INCLUDE}. */
export type CategoryRow = Prisma.CategoryGetPayload<{ include: typeof CATEGORY_INCLUDE }>

/**
 * Pasa una fila de Prisma a la línea del dominio con su cantidad de productos publicados.
 *
 * @param row - Línea con su foto y su conteo.
 * @returns La línea validada y su conteo.
 * @throws {RangeError | TypeError} En español, si la fila no cumple las reglas de la línea.
 */
export function toCategoryListing(row: CategoryRow): CategoryListing {
  return {
    category: createCategory({
      id: row.id,
      slug: row.slug,
      name: row.name,
      group: row.group,
      blurb: row.blurb,
      image: row.image === null ? null : { ...row.image },
      position: row.position,
    }),
    productCount: row._count.products,
  }
}
