import { Inject, Injectable } from '@nestjs/common'

import { CACHE_PORT, type CachePort } from '../../../shared/application/ports/cache.port'
import { readThrough } from '../../../shared/application/read-through'
import type { ProductGroup } from '../domain/category.entity'
import { Product, type ProductProps } from '../domain/product.entity'
import type {
  ProductFilter,
  ProductList,
  ProductRepository,
} from '../application/ports/product.repository.port'
import {
  CATALOG_CACHE_TTL_SECONDS,
  catalogCacheVersion,
  isCacheableProductList,
  productGroupCacheKey,
  productListCacheKey,
  productSlugCacheKey,
} from './catalog-cache'
import { PrismaProductRepository } from './prisma-product.repository'

/** Página cacheada: los productos van como datos planos y se vuelven a crear al leer. */
interface CachedProductList {
  items: ProductProps[]
  total: number
}

/**
 * Decora el repositorio de productos con la caché (60 s, claves `catalog:v{n}:products:*`). Cada
 * lectura lee la versión vigente (`catalog:version`): después de un bump, todo vuelve a Postgres.
 * La caché falla abierta: con Redis caído cada lectura va a Postgres.
 *
 * Los listados filtrados por `ids` no se cachean: la tienda los usa para conciliar las cantidades
 * del carrito con el stock, que cambia con cada reserva (y sus claves no se pueden borrar sin
 * enumerarlas). Tampoco las búsquedas, los tamaños de página que no usa la tienda ni las páginas
 * vacías (NV-13, {@link isCacheableProductList}): así un cliente no puede crear claves sin tope.
 */
@Injectable()
export class CachedProductRepository implements ProductRepository {
  /**
   * @param inner - Repositorio que lee de Postgres.
   * @param cache - Caché de lecturas.
   */
  constructor(
    @Inject(PrismaProductRepository) private readonly inner: ProductRepository,
    @Inject(CACHE_PORT) private readonly cache: CachePort,
  ) {}

  /** {@inheritDoc ProductRepository.list} */
  async list(filter: ProductFilter): Promise<ProductList> {
    if (!isCacheableProductList(filter)) return this.inner.list(filter)
    const key = productListCacheKey(filter, await catalogCacheVersion(this.cache))
    const cached = await this.cache.get<CachedProductList>(key)
    if (cached !== null) {
      return { items: cached.items.map((props) => Product.create(props)), total: cached.total }
    }
    const list = await this.inner.list(filter)
    if (list.items.length > 0) {
      const value: CachedProductList = {
        items: list.items.map((product) => product.toProps()),
        total: list.total,
      }
      await this.cache.set(key, value, CATALOG_CACHE_TTL_SECONDS)
    }
    return list
  }

  /** {@inheritDoc ProductRepository.findBySlug} */
  async findBySlug(slug: string): Promise<Product | null> {
    const props = await readThrough<ProductProps | null>(
      this.cache,
      productSlugCacheKey(slug, await catalogCacheVersion(this.cache)),
      CATALOG_CACHE_TTL_SECONDS,
      async () => (await this.inner.findBySlug(slug))?.toProps() ?? null,
    )
    return props === null ? null : Product.create(props)
  }

  /** {@inheritDoc ProductRepository.listPublishedByGroup} */
  async listPublishedByGroup(group: ProductGroup): Promise<Product[]> {
    const items = await readThrough<ProductProps[]>(
      this.cache,
      productGroupCacheKey(group, await catalogCacheVersion(this.cache)),
      CATALOG_CACHE_TTL_SECONDS,
      async () =>
        (await this.inner.listPublishedByGroup(group)).map((product) => product.toProps()),
    )
    return items.map((props) => Product.create(props))
  }
}
