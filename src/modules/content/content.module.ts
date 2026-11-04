import { Module } from '@nestjs/common'

import { ENV, type Env } from '../../config/env'
import { mediaCloudName } from '../../config/media'
import { UpdateAboutContentCommand } from './application/commands/update-about-content.command'
import { UpdateContentCommand } from './application/commands/update-content.command'
import {
  CONTENT_REPOSITORY,
  type ContentRepository,
} from './application/ports/content.repository.port'
import { GetAdminContentQuery } from './application/queries/get-admin-content.query'
import { GetContentQuery } from './application/queries/get-content.query'
import { CachedContentRepository } from './infrastructure/cached-content.repository'
import { PrismaContentRepository } from './infrastructure/prisma-content.repository'
import { AdminContentController } from './interface/admin-content.controller'
import { ContentController } from './interface/content.controller'

/**
 * Contenidos editables por clave, con caché (`content:*`, 300 s). Sirve `GET /content/*` y el
 * dashboard (`/admin/content/*`: lecturas sin caché y guardados que borran la caché y le avisan a
 * la tienda), y exporta {@link GetContentQuery}.
 */
@Module({
  controllers: [ContentController, AdminContentController],
  providers: [
    PrismaContentRepository,
    { provide: CONTENT_REPOSITORY, useClass: CachedContentRepository },
    {
      provide: GetContentQuery,
      useFactory: (contents: ContentRepository) => new GetContentQuery(contents),
      inject: [CONTENT_REPOSITORY],
    },
    {
      provide: GetAdminContentQuery,
      useFactory: (contents: ContentRepository) => new GetAdminContentQuery(contents),
      inject: [PrismaContentRepository],
    },
    {
      provide: UpdateContentCommand,
      useFactory: (contents: ContentRepository) => new UpdateContentCommand(contents),
      inject: [CONTENT_REPOSITORY],
    },
    {
      provide: UpdateAboutContentCommand,
      useFactory: (contents: ContentRepository, env: Env) =>
        new UpdateAboutContentCommand(contents, mediaCloudName(env)),
      inject: [CONTENT_REPOSITORY, ENV],
    },
  ],
  exports: [GetContentQuery],
})
export class ContentModule {}
