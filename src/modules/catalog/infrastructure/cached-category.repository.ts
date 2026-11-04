import { Inject, Injectable } from '@nestjs/common'

import { CACHE_PORT, type CachePort } from '../../../shared/application/ports/cache.port'
import { readThrough } from '../../../shared/application/read-through'
import { createCategory } from '../domain/category.entity'
import type {
  CategoryListing,
  CategoryRepository,
} from '../application/ports/category.repository.port'
import { CATALOG_CACHE_TTL_SECONDS, catalogCacheVersion, categoriesCacheKey } from './catalog-cache'
import { PrismaCategoryRepository } from './prisma-category.repository'

/**
 * Decora el repositorio de líneas con la caché (60 s, clave `catalog:v{n}:categories`, con la
 * versión vigente leída en cada lectura).
 */
@Injectable()
export class CachedCategoryRepository implements CategoryRepository {
  /**
   * @param inner - Repositorio que lee de Postgres.
   * @param cache - Caché de lecturas (falla abierta).
   */
  constructor(
    @Inject(PrismaCategoryRepository) private readonly inner: CategoryRepository,
    @Inject(CACHE_PORT) private readonly cache: CachePort,
  ) {}

  /** {@inheritDoc CategoryRepository.list} */
  async list(): Promise<CategoryListing[]> {
    const listings = await readThrough(
      this.cache,
      categoriesCacheKey(await catalogCacheVersion(this.cache)),
      CATALOG_CACHE_TTL_SECONDS,
      () => this.inner.list(),
    )
    return listings.map(({ category, productCount }) => ({
      category: createCategory(category),
      productCount,
    }))
  }
}
