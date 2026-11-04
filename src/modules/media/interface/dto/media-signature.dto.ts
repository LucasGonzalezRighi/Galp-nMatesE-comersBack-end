// Pedido y respuesta de la firma de una subida (`MediaSignatureInput` y `MediaSignature` del
// contrato), con la regla y el mensaje de `mediaSignatureSchema` de `@galpon/schemas`.

import { ApiProperty, ApiSchema } from '@nestjs/swagger'
import { IsIn } from 'class-validator'

import { RawValue } from '../../../identity/interface/dto/identity-fields'
import { MEDIA_PURPOSES, type MediaPurpose } from '../../domain/media'

/** Mensaje de un uso de foto que no existe (`MESSAGES.invalidMediaPurpose` del front). */
export const INVALID_MEDIA_PURPOSE_MESSAGE = 'Elegí para qué es la foto'

/** Cuerpo de `POST /admin/media/signature` (`MediaSignatureInput`). */
@ApiSchema({ name: 'MediaSignatureInput' })
export class MediaSignatureInputDto {
  /** Para qué es la foto: define la carpeta de Cloudinary. */
  @ApiProperty({
    type: 'string',
    enum: [...MEDIA_PURPOSES],
    description:
      'Para qué es la foto; define la carpeta de Cloudinary donde se guarda: `product` → `galpon/productos`, `category` → `galpon/lineas`, `partner` → `galpon/socios` y `site` → `galpon/sitio`.',
  })
  @RawValue()
  @IsIn(MEDIA_PURPOSES, { message: INVALID_MEDIA_PURPOSE_MESSAGE })
  purpose!: MediaPurpose
}

/** Respuesta de `POST /admin/media/signature` (`MediaSignature`), solo para Swagger. */
@ApiSchema({ name: 'MediaSignature' })
export class MediaSignatureDto {
  /** Segundos desde 1970. */
  @ApiProperty({ type: 'integer', minimum: 0, description: 'Momento de la firma, en hora Unix.' })
  timestamp!: number

  /** Firma de `folder` y `timestamp`. */
  @ApiProperty({ type: 'string', minLength: 1, description: 'Firma de la subida.' })
  signature!: string

  /** Clave pública de la cuenta. */
  @ApiProperty({ type: 'string', minLength: 1, description: 'Clave pública de Cloudinary.' })
  apiKey!: string

  /** Nube de Cloudinary. */
  @ApiProperty({ type: 'string', minLength: 1, description: 'Nombre de la cuenta de Cloudinary.' })
  cloudName!: string

  /** Carpeta de la subida. */
  @ApiProperty({
    type: 'string',
    minLength: 1,
    description: 'Carpeta donde se guarda la foto; la subida tiene que mandar este mismo valor.',
  })
  folder!: string
}
