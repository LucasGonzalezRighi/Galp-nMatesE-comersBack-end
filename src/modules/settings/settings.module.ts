import { Module } from '@nestjs/common'

import { UpdateSettingsCommand } from './application/commands/update-settings.command'
import {
  SETTINGS_REPOSITORY,
  type SettingsRepository,
} from './application/ports/settings.repository.port'
import { GetAdminSettingsQuery } from './application/queries/get-admin-settings.query'
import { GetPublicSettingsQuery } from './application/queries/get-public-settings.query'
import { GetStoreSettingsQuery } from './application/queries/get-store-settings.query'
import { CachedSettingsRepository } from './infrastructure/cached-settings.repository'
import { PrismaSettingsRepository } from './infrastructure/prisma-settings.repository'
import { AdminSettingsController } from './interface/admin-settings.controller'
import { SettingsController } from './interface/settings.controller'

/**
 * Ajustes de la tienda con caché (`settings:*`, 300 s). Sirve `GET /settings/public` y el
 * dashboard (`/admin/settings`: lectura sin caché y guardado que borra la caché y le avisa a la
 * tienda), y exporta {@link GetPublicSettingsQuery} y {@link GetStoreSettingsQuery} (para otros
 * módulos, como el catálogo).
 */
@Module({
  controllers: [SettingsController, AdminSettingsController],
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
    {
      provide: GetAdminSettingsQuery,
      useFactory: (settings: SettingsRepository) => new GetAdminSettingsQuery(settings),
      inject: [PrismaSettingsRepository],
    },
    {
      provide: UpdateSettingsCommand,
      useFactory: (settings: SettingsRepository) => new UpdateSettingsCommand(settings),
      inject: [SETTINGS_REPOSITORY],
    },
  ],
  exports: [GetPublicSettingsQuery, GetStoreSettingsQuery],
})
export class SettingsModule {}
