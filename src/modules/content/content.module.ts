import { Module } from '@nestjs/common'

import {
  CONTENT_REPOSITORY,
  type ContentRepository,
} from './application/ports/content.repository.port'
import { GetContentQuery } from './application/queries/get-content.query'
import { CachedContentRepository } from './infrastructure/cached-content.repository'
import { PrismaContentRepository } from './infrastructure/prisma-content.repository'
import { ContentController } from './interface/content.controller'

/**
 * Contenidos editables por clave, con caché (`content:*`, 300 s). Sirve `GET /content/*` y
 * exporta {@link GetContentQuery}.
 */
@Module({
  controllers: [ContentController],
  providers: [
    PrismaContentRepository,
    { provide: CONTENT_REPOSITORY, useClass: CachedContentRepository },
    {
      provide: GetContentQuery,
      useFactory: (contents: ContentRepository) => new GetContentQuery(contents),
      inject: [CONTENT_REPOSITORY],
    },
  ],
  exports: [GetContentQuery],
})
export class ContentModule {}
