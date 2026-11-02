import { Inject, Injectable } from '@nestjs/common'

import { CACHE_PORT, type CachePort } from '../../../shared/application/ports/cache.port'
import { readThrough } from '../../../shared/application/read-through'
import type { ContentKey } from '../domain/content-key'
import type { ContentRepository } from '../application/ports/content.repository.port'
import { PrismaContentRepository } from './prisma-content.repository'

/** Vida de los contenidos en la caché (claves `content:*`). */
export const CONTENT_CACHE_TTL_SECONDS = 300

/** Decora el repositorio de contenidos con la caché (300 s, clave `content:{key}`). */
@Injectable()
export class CachedContentRepository implements ContentRepository {
  /**
   * @param inner - Repositorio que lee de Postgres.
   * @param cache - Caché de lecturas (falla abierta).
   */
  constructor(
    @Inject(PrismaContentRepository) private readonly inner: ContentRepository,
    @Inject(CACHE_PORT) private readonly cache: CachePort,
  ) {}

  /** {@inheritDoc ContentRepository.find} */
  find(key: ContentKey): Promise<unknown> {
    return readThrough(this.cache, `content:${key}`, CONTENT_CACHE_TTL_SECONDS, () =>
      this.inner.find(key),
    )
  }
}
