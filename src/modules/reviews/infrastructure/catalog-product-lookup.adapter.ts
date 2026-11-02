import { Inject, Injectable } from '@nestjs/common'

import {
  PRODUCT_REPOSITORY,
  type ProductRepository,
} from '../../catalog/application/ports/product.repository.port'
import type { ProductLookupPort } from '../application/ports/product-lookup.port'

/**
 * Resuelve el producto de un slug con el repositorio del catálogo (con su caché de 60 s), que
 * acepta slugs anteriores y solo devuelve publicados.
 */
@Injectable()
export class CatalogProductLookupAdapter implements ProductLookupPort {
  /** @param products - Repositorio de productos del catálogo. */
  constructor(@Inject(PRODUCT_REPOSITORY) private readonly products: ProductRepository) {}

  /** {@inheritDoc ProductLookupPort.findPublishedIdBySlug} */
  async findPublishedIdBySlug(slug: string): Promise<string | null> {
    const product = await this.products.findBySlug(slug)
    return product?.id ?? null
  }
}
