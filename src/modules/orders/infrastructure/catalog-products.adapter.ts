import { Injectable } from '@nestjs/common'

import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service'
import type { ProductCatalogPort } from '../application/ports/product-catalog.port'
import type { PricedCombo, PricedProduct } from '../domain/pricing'
import { UUID_PATTERN } from './order.mapper'

/**
 * Comprueba que los ids sean una lista de textos y deja los que son UUID, sin repetir.
 *
 * @throws {TypeError} En español, si `ids` no es una lista de textos.
 */
function validIds(ids: readonly string[], label: string): string[] {
  const received: readonly unknown[] = ids
  if (!Array.isArray(received) || received.some((id) => typeof id !== 'string')) {
    throw new TypeError(`Los ids de ${label} tienen que ser una lista de textos`)
  }
  return [...new Set(ids.filter((id) => UUID_PATTERN.test(id)))]
}

/**
 * Productos y combos para cotizar, leídos directo de `products` + `inventory` y de `combos` +
 * `combo_items` (sin la caché del catálogo, para no cotizar con stock ni precios viejos). Trae
 * también los no publicados: la cotización los marca `unavailable`. Es solo lectura de tablas del
 * catálogo (ADR 0001).
 */
@Injectable()
export class CatalogProductsAdapter implements ProductCatalogPort {
  /** @param prisma - Cliente de Prisma de la app. */
  constructor(private readonly prisma: PrismaService) {}

  /**
   * {@inheritDoc ProductCatalogPort.findForCart}
   *
   * @throws {TypeError} En español, si `ids` no es una lista de textos.
   */
  async findForCart(ids: readonly string[]): Promise<PricedProduct[]> {
    const valid = validIds(ids, 'los productos')
    if (valid.length === 0) return []
    const rows = await this.prisma.product.findMany({
      where: { id: { in: valid } },
      select: {
        id: true,
        slug: true,
        name: true,
        priceArs: true,
        status: true,
        category: { select: { group: true } },
        inventory: { select: { onHand: true, reserved: true } },
      },
    })
    return rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      group: row.category.group,
      priceArs: row.priceArs,
      published: row.status === 'published',
      available: Math.max(0, (row.inventory?.onHand ?? 0) - (row.inventory?.reserved ?? 0)),
    }))
  }

  /**
   * {@inheritDoc ProductCatalogPort.findCombosForCart}
   *
   * @throws {TypeError} En español, si `ids` no es una lista de textos.
   */
  async findCombosForCart(ids: readonly string[]): Promise<PricedCombo[]> {
    const valid = validIds(ids, 'los combos')
    if (valid.length === 0) return []
    const rows = await this.prisma.combo.findMany({
      where: { id: { in: valid } },
      select: {
        id: true,
        name: true,
        status: true,
        priceArs: true,
        items: { orderBy: { position: 'asc' }, select: { productId: true } },
      },
    })
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      status: row.status,
      priceArs: row.priceArs,
      productIds: row.items.map((piece) => piece.productId),
    }))
  }
}
