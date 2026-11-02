import { Controller, Get } from '@nestjs/common'
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import { SkipThrottle } from '@nestjs/throttler'

import { ApiProblemResponses } from '../../../shared/infrastructure/http/openapi'
import { GetPublicSettingsQuery } from '../application/queries/get-public-settings.query'
import type { PublicSettings } from '../application/read-models'
import { PublicSettingsDto } from './dto/settings.response.dto'

/**
 * Ajustes públicos de la tienda (`GET /settings/public`).
 *
 * Sin límite de pedidos por IP: la tienda lee desde un solo servidor (SSR/ISR y `next build`) y
 * el spec §3.2 solo limita login, formularios públicos y creación de pedidos.
 */
@ApiTags('settings')
@SkipThrottle()
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
