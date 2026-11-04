import type { Prisma } from '../../../generated/prisma/client'
import type { StoredCombo } from '../application/ports/combo.repository.port'
import type { ComboRecord } from '../domain/combo.entity'
import { PRODUCT_INCLUDE, toProduct } from './product.mapper'

/**
 * Relaciones que se leen con cada combo: sus piezas por `position`, cada una con el producto
 * completo (en cualquier estado) para calcular los derivados con los datos vigentes.
 */
export const COMBO_INCLUDE = {
  items: {
    orderBy: { position: 'asc' },
    select: { product: { include: PRODUCT_INCLUDE } },
  },
} satisfies Prisma.ComboInclude

/** Fila de `combos` con las relaciones de {@link COMBO_INCLUDE}. */
export type ComboRow = Prisma.ComboGetPayload<{ include: typeof COMBO_INCLUDE }>

/**
 * Pasa una fila de Prisma al combo guardado con sus piezas.
 *
 * @param row - Combo con sus piezas.
 * @returns El combo (`productIds` en el orden de sus piezas) y sus productos, en ese orden.
 * @throws {RangeError | TypeError} En español, si un producto no cumple las reglas del dominio.
 */
export function toStoredCombo(row: ComboRow): StoredCombo {
  const combo: ComboRecord = {
    id: row.id,
    name: row.name,
    description: row.description,
    productIds: row.items.map(({ product }) => product.id),
    priceArs: row.priceArs,
    status: row.status,
    position: row.position,
  }
  return { combo, pieces: row.items.map(({ product }) => toProduct(product)) }
}
