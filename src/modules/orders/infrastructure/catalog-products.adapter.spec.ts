import { describe, expect, it } from 'vitest'

import type { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service'
import { CatalogProductsAdapter } from './catalog-products.adapter'

const MATE_ID = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b'
const BOMBILLA_ID = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c'

/** Fila de `products` como la trae el `select` del adaptador. */
function row(id: string, group: string, leathers: string[]) {
  return {
    id,
    slug: `producto-${group}`,
    name: `Producto ${group}`,
    priceArs: 1000,
    status: 'published',
    leathers,
    category: { group },
    inventory: { onHand: 5, reserved: 1 },
  }
}

/** Cliente de Prisma falso (sin base) que devuelve siempre las mismas filas. */
function adapterWith(rows: ReturnType<typeof row>[]): CatalogProductsAdapter {
  const prisma = { product: { findMany: () => Promise.resolve(rows) } } as unknown as PrismaService
  return new CatalogProductsAdapter(prisma)
}

describe('CatalogProductsAdapter.findForCart', () => {
  it('cotiza los cueros de un mate y no los de un no-mate (como el catálogo, que los ignora)', async () => {
    const adapter = adapterWith([
      row(MATE_ID, 'mate', ['Negro', 'Crudo']),
      row(BOMBILLA_ID, 'bombilla', ['Negro']),
    ])

    const products = await adapter.findForCart([MATE_ID, BOMBILLA_ID])

    expect(
      products.map(({ id, group, leathers, available }) => ({ id, group, leathers, available })),
    ).toEqual([
      { id: MATE_ID, group: 'mate', leathers: ['Negro', 'Crudo'], available: 4 },
      { id: BOMBILLA_ID, group: 'bombilla', leathers: [], available: 4 },
    ])
  })
})
