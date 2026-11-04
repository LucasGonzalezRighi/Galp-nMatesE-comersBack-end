import type { Prisma } from '../../../generated/prisma/client'
import type { AdminProductRecord } from '../application/ports/admin-product.repository.port'
import { PRODUCT_INCLUDE, toProduct } from './product.mapper'

/**
 * Relaciones de un producto del dashboard: las de la tienda ({@link PRODUCT_INCLUDE}) más los
 * slugs anteriores, del más viejo al más nuevo.
 */
export const ADMIN_PRODUCT_INCLUDE = {
  ...PRODUCT_INCLUDE,
  slugHistory: {
    orderBy: [{ createdAt: 'asc' }, { slug: 'asc' }],
    select: { slug: true },
  },
} satisfies Prisma.ProductInclude

/** Fila de `products` con las relaciones de {@link ADMIN_PRODUCT_INCLUDE}. */
export type AdminProductRow = Prisma.ProductGetPayload<{ include: typeof ADMIN_PRODUCT_INCLUDE }>

/**
 * Pasa una fila al producto del dashboard.
 *
 * @param row - Producto con sus relaciones y su historial de slugs.
 * @returns El producto, sus slugs anteriores y sus fechas.
 * @throws {RangeError | TypeError} En español, si la fila no cumple las reglas del producto.
 */
export function toAdminProductRecord(row: AdminProductRow): AdminProductRecord {
  return {
    product: toProduct(row),
    previousSlugs: row.slugHistory.map(({ slug }) => slug),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}
