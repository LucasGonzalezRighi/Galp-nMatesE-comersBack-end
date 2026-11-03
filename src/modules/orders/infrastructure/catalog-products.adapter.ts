import { Injectable } from '@nestjs/common'

import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service'
import type { ProductCatalogPort } from '../application/ports/product-catalog.port'
import type { PricedProduct } from '../domain/pricing'
import { UUID_PATTERN } from './order.mapper'

/**
 * Productos para cotizar, leídos directo de `products` + `inventory` (sin la caché del catálogo,
 * para no cotizar con stock viejo). Trae también los no publicados: la cotización los marca
 * `unavailable`. Es solo lectura de tablas del catálogo (ADR 0001).
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
    const received: readonly unknown[] = ids
    if (!Array.isArray(received) || received.some((id) => typeof id !== 'string')) {
      throw new TypeError('Los ids de los productos tienen que ser una lista de textos')
    }
    const valid = [...new Set(ids.filter((id) => UUID_PATTERN.test(id)))]
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
}
