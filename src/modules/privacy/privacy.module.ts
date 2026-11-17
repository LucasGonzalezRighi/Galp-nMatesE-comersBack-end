import { Module } from '@nestjs/common'

import {
  EXPIRED_DATA_REPOSITORY,
  type ExpiredDataRepository,
} from './application/ports/expired-data.repository.port'
import { PurgeExpiredDataCommand } from './application/purge-expired-data.command'
import { PrismaExpiredDataRepository } from './infrastructure/prisma-expired-data.repository'
import { PrivacyPurgeSweep } from './infrastructure/privacy-purge.sweep'

/**
 * Datos personales (LS-5): la purga diaria con los plazos de `RETENTION`
 * (`docs/adr/0008-datos-personales.md`). No expone HTTP.
 */
@Module({
  providers: [
    { provide: EXPIRED_DATA_REPOSITORY, useClass: PrismaExpiredDataRepository },
    {
      provide: PurgeExpiredDataCommand,
      useFactory: (data: ExpiredDataRepository) => new PurgeExpiredDataCommand(data),
      inject: [EXPIRED_DATA_REPOSITORY],
    },
    PrivacyPurgeSweep,
  ],
})
export class PrivacyModule {}
