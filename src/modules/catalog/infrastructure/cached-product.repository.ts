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
import { PrismaProductRepository } from './prisma-product.repository'

/** Vida de las lecturas del catálogo en la caché (claves `catalog:*`). */
export const CATALOG_CACHE_TTL_SECONDS = 60

/** Prefijo de las claves de productos en la caché. */
export const PRODUCT_CACHE_PREFIX = 'catalog:products'

/** Página cacheada: los productos van como datos planos y se vuelven a crear al leer. */
interface CachedProductList {
  items: ProductProps[]
  total: number
}

/**
 * Clave del listado: el filtro serializado con un orden de campos fijo, para que dos filtros
 * iguales den la misma clave.
 */
function listKey(filter: ProductFilter): string {
  const parts = [
    filter.category ?? null,
    filter.group ?? null,
    filter.ids ?? null,
    filter.q ?? null,
    filter.sort,
    filter.featured ?? false,
    filter.page,
    filter.pageSize,
  ]
  return `${PRODUCT_CACHE_PREFIX}:list:${JSON.stringify(parts)}`
}

/**
 * Decora el repositorio de productos con la caché (60 s, claves `catalog:products:*`). La caché
 * falla abierta: con Redis caído cada lectura va a Postgres.
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
    const cached = await readThrough<CachedProductList>(
      this.cache,
      listKey(filter),
      CATALOG_CACHE_TTL_SECONDS,
      async () => {
        const list = await this.inner.list(filter)
        return { items: list.items.map((product) => product.toProps()), total: list.total }
      },
    )
    return { items: cached.items.map((props) => Product.create(props)), total: cached.total }
  }

  /** {@inheritDoc ProductRepository.findBySlug} */
  async findBySlug(slug: string): Promise<Product | null> {
    const props = await readThrough<ProductProps | null>(
      this.cache,
      `${PRODUCT_CACHE_PREFIX}:slug:${slug}`,
      CATALOG_CACHE_TTL_SECONDS,
      async () => (await this.inner.findBySlug(slug))?.toProps() ?? null,
    )
    return props === null ? null : Product.create(props)
  }

  /** {@inheritDoc ProductRepository.listPublishedByGroup} */
  async listPublishedByGroup(group: ProductGroup): Promise<Product[]> {
    const items = await readThrough<ProductProps[]>(
      this.cache,
      `${PRODUCT_CACHE_PREFIX}:group:${group}`,
      CATALOG_CACHE_TTL_SECONDS,
      async () =>
        (await this.inner.listPublishedByGroup(group)).map((product) => product.toProps()),
    )
    return items.map((props) => Product.create(props))
  }
}
