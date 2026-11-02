import { Module } from '@nestjs/common'

import {
  SETTINGS_REPOSITORY,
  type SettingsRepository,
} from './application/ports/settings.repository.port'
import { GetPublicSettingsQuery } from './application/queries/get-public-settings.query'
import { GetStoreSettingsQuery } from './application/queries/get-store-settings.query'
import { CachedSettingsRepository } from './infrastructure/cached-settings.repository'
import { PrismaSettingsRepository } from './infrastructure/prisma-settings.repository'
import { SettingsController } from './interface/settings.controller'

/**
 * Ajustes de la tienda con caché (`settings:*`, 300 s). Sirve `GET /settings/public` y exporta
 * {@link GetPublicSettingsQuery} y {@link GetStoreSettingsQuery} (para otros módulos, como el
 * catálogo).
 */
@Module({
  controllers: [SettingsController],
  providers: [
    PrismaSettingsRepository,
    { provide: SETTINGS_REPOSITORY, useClass: CachedSettingsRepository },
    {
      provide: GetPublicSettingsQuery,
      useFactory: (settings: SettingsRepository) => new GetPublicSettingsQuery(settings),
      inject: [SETTINGS_REPOSITORY],
    },
    {
      provide: GetStoreSettingsQuery,
      useFactory: (settings: SettingsRepository) => new GetStoreSettingsQuery(settings),
      inject: [SETTINGS_REPOSITORY],
    },
  ],
  exports: [GetPublicSettingsQuery, GetStoreSettingsQuery],
})
export class SettingsModule {}
