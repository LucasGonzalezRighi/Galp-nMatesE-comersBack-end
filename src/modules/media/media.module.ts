import { Module } from '@nestjs/common'

import { ENV, type Env } from '../../config/env'
import { CLOCK, type Clock } from '../../shared/domain/clock'
import { SignUploadCommand } from './application/commands/sign-upload.command'
import { MEDIA_STORAGE } from './application/ports/media-storage.port'
import { UPLOAD_SIGNER, type UploadSigner } from './application/ports/upload-signer.port'
import { createMediaStorage } from './infrastructure/media-storage'
import { createUploadSigner } from './infrastructure/upload-signers'
import { AdminMediaController } from './interface/admin-media.controller'

/**
 * Fotos: la firma de las subidas del dashboard (`POST /admin/media/signature`, Cloudinary o
 * simulada según `MEDIA_MODE`) y dónde viven las fotos nuevas. Exporta {@link MEDIA_STORAGE}
 * (proveedor y nube) para los módulos que guardan fotos (el catálogo). No llama a la Admin API de
 * Cloudinary (Ruling B-74).
 */
@Module({
  controllers: [AdminMediaController],
  providers: [
    { provide: UPLOAD_SIGNER, useFactory: (env: Env) => createUploadSigner(env), inject: [ENV] },
    { provide: MEDIA_STORAGE, useFactory: (env: Env) => createMediaStorage(env), inject: [ENV] },
    {
      provide: SignUploadCommand,
      useFactory: (signer: UploadSigner, clock: Clock) => new SignUploadCommand(signer, clock),
      inject: [UPLOAD_SIGNER, CLOCK],
    },
  ],
  exports: [MEDIA_STORAGE],
})
export class MediaModule {}
