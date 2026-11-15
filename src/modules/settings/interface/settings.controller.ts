import { Controller, Get } from '@nestjs/common'
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'

import { ApiProblemResponses } from '../../../shared/infrastructure/http/openapi'
import { PublicRead } from '../../../shared/infrastructure/throttler/public-read'
import { GetPublicSettingsQuery } from '../application/queries/get-public-settings.query'
import type { PublicSettings } from '../application/read-models'
import { PublicSettingsDto } from './dto/settings.response.dto'

/**
 * Ajustes públicos de la tienda (`GET /settings/public`).
 *
 * Lectura pública (`@PublicRead()`, NV-18): límite de 300 pedidos por minuto por IP real del
 * cliente, que solo cuenta con `TRUST_PROXY`; el servidor de la tienda (SSR/ISR y `next build`)
 * no se limita.
 */
@ApiTags('settings')
@PublicRead()
@Controller('settings')
export class SettingsController {
  /** @param getPublicSettings - Query de los ajustes públicos. */
  constructor(private readonly getPublicSettings: GetPublicSettingsQuery) {}

  /**
   * Devuelve lo que la tienda necesita: descuento del kit, envíos, cuotas, mail de contacto,
   * cómo mostrar el precio y datos del vendedor (sin la alícuota de IVA ni el stock bajo).
   *
   * @returns Los ajustes con la forma `PublicSettings` del contrato.
   */
  @Get('public')
  @ApiOperation({ operationId: 'getPublicSettings', summary: 'Obtener los ajustes públicos' })
  @ApiOkResponse({ type: PublicSettingsDto, description: 'Ajustes públicos.' })
  @ApiProblemResponses(429, 500)
  get(): Promise<PublicSettings> {
    return this.getPublicSettings.execute()
  }
}
