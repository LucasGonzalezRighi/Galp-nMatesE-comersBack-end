import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common'
import {
  ApiCookieAuth,
  ApiExtraModels,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger'
import { SkipThrottle } from '@nestjs/throttler'

import {
  AdminCsrfGuard,
  AdminSessionGuard,
} from '../../../shared/infrastructure/auth/session.guards'
import { ApiProblemResponses } from '../../../shared/infrastructure/http/openapi'
import { MarkMessageCommand } from '../application/commands/mark-message.command'
import { ListAdminMessagesQuery } from '../application/queries/list-admin-messages.query'
import type { ContactMessagePage, ContactMessageView } from '../application/read-models'
import { AdminMessagesQueryDto, MessageUpdateDto } from './dto/admin-messages.dto'
import { ContactMessageDto, ContactMessagePageDto } from './dto/support.response.dto'

/** Seguridad de las escrituras del dashboard: sesión de admin y token CSRF. */
const SESSION_AND_CSRF = { adminSession: [], csrfToken: [] }

/** Parámetro `{id}` de un mensaje (`MessageId` del contrato). */
const MESSAGE_ID_PARAM = {
  name: 'id',
  description: 'Identificador de un mensaje.',
  schema: { type: 'string', minLength: 1, maxLength: 80 },
} as const

/**
 * Bandeja del dashboard (`/admin/messages`): listado y marcar leído o no leído. La lectura pide la
 * sesión de admin (401 sin ella) y la escritura, además, el token CSRF (403). No avisa nada a la
 * tienda. El id llega tal cual: uno que no existe (o que no es un UUID) responde 404 "No existe
 * ese mensaje."; el pipe corre antes, así que un cuerpo inválido a un id que no existe da 422
 * (Ruling B-80).
 */
@ApiTags('admin')
@ApiExtraModels(ContactMessageDto, ContactMessagePageDto, MessageUpdateDto)
@SkipThrottle()
@Controller('admin/messages')
export class AdminMessagesController {
  /**
   * @param listAdminMessages - Listado de la bandeja.
   * @param markMessage - Leído o no leído.
   */
  constructor(
    private readonly listAdminMessages: ListAdminMessagesQuery,
    private readonly markMessage: MarkMessageCommand,
  ) {}

  /**
   * Lista la bandeja, del más nuevo al más viejo, de a 20.
   *
   * @param query - Página, tipo y leído, ya validados.
   * @returns La página con la forma `ContactMessagePage` del contrato.
   */
  @Get()
  @UseGuards(AdminSessionGuard)
  @ApiCookieAuth('adminSession')
  @ApiOperation({ operationId: 'listAdminMessages', summary: 'Listar los mensajes' })
  @ApiOkResponse({ type: ContactMessagePageDto, description: 'Página de mensajes.' })
  @ApiProblemResponses(401, 422, 429, 500)
  list(@Query() query: AdminMessagesQueryDto): Promise<ContactMessagePage> {
    return this.listAdminMessages.execute(query.toFilter(), query.page)
  }

  /**
   * Marca el mensaje como leído o no leído.
   *
   * @param id - Id del mensaje.
   * @param body - Cambio ya validado.
   * @returns El mensaje como quedó.
   */
  @Patch(':id')
  @UseGuards(AdminSessionGuard, AdminCsrfGuard)
  @ApiSecurity(SESSION_AND_CSRF)
  @ApiOperation({
    operationId: 'updateAdminMessage',
    summary: 'Marcar un mensaje como leído o no leído',
  })
  @ApiParam(MESSAGE_ID_PARAM)
  @ApiOkResponse({ type: ContactMessageDto, description: 'Mensaje modificado.' })
  @ApiProblemResponses(401, 403, 404, 422, 429, 500)
  update(@Param('id') id: string, @Body() body: MessageUpdateDto): Promise<ContactMessageView> {
    return this.markMessage.execute(id, body.read)
  }
}
