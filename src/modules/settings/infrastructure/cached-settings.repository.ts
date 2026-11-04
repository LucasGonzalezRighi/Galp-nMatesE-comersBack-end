import { Inject, Injectable } from '@nestjs/common'

import { CACHE_PORT, type CachePort } from '../../../shared/application/ports/cache.port'
import { readThrough } from '../../../shared/application/read-through'
import { createStoreSettings, type StoreSettings } from '../domain/store-settings.entity'
import type {
  SettingsChanges,
  SettingsRepository,
  SettingsWrite,
} from '../application/ports/settings.repository.port'
import { PrismaSettingsRepository } from './prisma-settings.repository'

/** Vida de los ajustes en la caché (claves `settings:*`). */
export const SETTINGS_CACHE_TTL_SECONDS = 300

/** Clave de los ajustes completos en la caché. */
export const SETTINGS_CACHE_KEY = 'settings:store'

/**
 * Decora el repositorio de ajustes con la caché (300 s, clave `settings:store`): las lecturas pasan
 * por ella y cada guardado la borra después del commit.
 */
@Injectable()
export class CachedSettingsRepository implements SettingsRepository {
  /**
   * @param inner - Repositorio que lee de Postgres.
   * @param cache - Caché de lecturas (falla abierta).
   */
  constructor(
    @Inject(PrismaSettingsRepository) private readonly inner: SettingsRepository,
    @Inject(CACHE_PORT) private readonly cache: CachePort,
  ) {}

  /** {@inheritDoc SettingsRepository.get} */
  async get(): Promise<StoreSettings> {
    const settings = await readThrough(
      this.cache,
      SETTINGS_CACHE_KEY,
      SETTINGS_CACHE_TTL_SECONDS,
      () => this.inner.get(),
    )
    return createStoreSettings(settings)
  }

  /** {@inheritDoc SettingsRepository.save} */
  async save(changes: SettingsChanges, write: SettingsWrite): Promise<StoreSettings> {
    const saved = await this.inner.save(changes, write)
    // Después del commit: una lectura que llegue en el medio vuelve a Postgres y ve lo nuevo.
    await this.cache.del(SETTINGS_CACHE_KEY)
    return saved
  }
}
