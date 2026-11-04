import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common'
import {
  ApiBody,
  ApiCookieAuth,
  ApiExtraModels,
  ApiOkResponse,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger'
import { SkipThrottle } from '@nestjs/throttler'

import type { SessionRecord } from '../../../shared/application/ports/session.port'
import { CurrentSession } from '../../../shared/infrastructure/auth/current-session.decorator'
import { adminUserIdOf } from '../../../shared/infrastructure/auth/session-ids'
import {
  AdminCsrfGuard,
  AdminSessionGuard,
} from '../../../shared/infrastructure/auth/session.guards'
import { ApiProblemResponses, schemaRef } from '../../../shared/infrastructure/http/openapi'
import { UpdateSettingsCommand } from '../application/commands/update-settings.command'
import { GetAdminSettingsQuery } from '../application/queries/get-admin-settings.query'
import type { AdminSettings } from '../application/read-models'
import { AdminSettingsInputDto } from './dto/settings-input.dto'
import { PublicSettingsDto } from './dto/settings.response.dto'

/**
 * Ajustes del dashboard (`/admin/settings`). La lectura pide la sesión de admin (401) y va a
 * Postgres sin caché; el guardado pide además el token CSRF (403), reemplaza todos los ajustes
 * (los envíos quedan en el orden `home`, `branch`, `pickup` con su nombre de siempre; el `label`
 * del cuerpo se ignora) y le avisa a la tienda que regenere ajustes, productos y combos
 * (`storefront.stale` en el outbox, en la misma transacción); un 4xx no avisa nada.
 */
@ApiTags('admin')
@ApiExtraModels(PublicSettingsDto)
@SkipThrottle()
@Controller('admin/settings')
export class AdminSettingsController {
  /**
   * @param getAdminSettings - Lectura sin caché.
   * @param updateSettings - Guardado.
   */
  constructor(
    private readonly getAdminSettings: GetAdminSettingsQuery,
    private readonly updateSettings: UpdateSettingsCommand,
  ) {}

  /** @returns Los ajustes públicos más el umbral de poco stock y el IVA. */
  @Get()
  @UseGuards(AdminSessionGuard)
  @ApiCookieAuth('adminSession')
  @ApiOperation({ operationId: 'getAdminSettings', summary: 'Obtener los ajustes del dashboard' })
  @ApiOkResponse({ schema: schemaRef('AdminSettings'), description: 'Ajustes.' })
  @ApiProblemResponses(401, 429, 500)
  get(): Promise<AdminSettings> {
    return this.getAdminSettings.execute()
  }

  /**
   * @param body - Ajustes completos, ya validados y normalizados (422 si no).
   * @param session - Sesión de admin.
   * @returns Los ajustes guardados.
   */
  @Put()
  @UseGuards(AdminSessionGuard, AdminCsrfGuard)
  @ApiSecurity({ adminSession: [], csrfToken: [] })
  @ApiOperation({ operationId: 'updateAdminSettings', summary: 'Guardar los ajustes' })
  @ApiBody({ required: true, schema: schemaRef('AdminSettings') })
  @ApiOkResponse({ schema: schemaRef('AdminSettings'), description: 'Ajustes guardados.' })
  @ApiProblemResponses(401, 403, 422, 429, 500)
  save(
    @Body() body: AdminSettingsInputDto,
    @CurrentSession() session: SessionRecord,
  ): Promise<AdminSettings> {
    return this.updateSettings.execute(body, adminUserIdOf(session))
  }
}
