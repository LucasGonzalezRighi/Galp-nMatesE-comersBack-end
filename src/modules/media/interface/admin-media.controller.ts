import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common'
import {
  ApiBody,
  ApiExtraModels,
  ApiOkResponse,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger'

import {
  AdminCsrfGuard,
  AdminSessionGuard,
} from '../../../shared/infrastructure/auth/session.guards'
import { ApiProblemResponses, schemaRef } from '../../../shared/infrastructure/http/openapi'
import { SignUploadCommand } from '../application/commands/sign-upload.command'
import type { UploadSignature } from '../application/ports/upload-signer.port'
import { MediaSignatureDto, MediaSignatureInputDto } from './dto/media-signature.dto'

/**
 * Fotos del dashboard: la firma para subir una foto directo a Cloudinary desde el navegador.
 * Pide la sesión de admin (401) y el token CSRF (403). En `MEDIA_MODE=simulated` la firma es la
 * del mock del front; en `cloudinary`, la de la cuenta (el secreto no sale del back).
 */
@ApiTags('admin')
@ApiExtraModels(MediaSignatureInputDto, MediaSignatureDto)
@Controller('admin/media')
export class AdminMediaController {
  /** @param signUpload - Firma de la subida. */
  constructor(private readonly signUpload: SignUploadCommand) {}

  /**
   * Firma una subida a la carpeta de `purpose`.
   *
   * @param body - Uso de la foto, ya validado (422 "Elegí para qué es la foto" si no).
   * @returns Los datos firmados (200).
   */
  @Post('signature')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdminSessionGuard, AdminCsrfGuard)
  @ApiSecurity({ adminSession: [], csrfToken: [] })
  @ApiOperation({ operationId: 'createMediaSignature', summary: 'Firmar una subida de foto' })
  @ApiBody({ required: true, schema: schemaRef('MediaSignatureInput') })
  @ApiOkResponse({ schema: schemaRef('MediaSignature'), description: 'Firma de subida.' })
  @ApiProblemResponses(401, 403, 422, 429, 500)
  sign(@Body() body: MediaSignatureInputDto): UploadSignature {
    return this.signUpload.execute(body.purpose)
  }
}
