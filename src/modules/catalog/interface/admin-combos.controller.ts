import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common'
import {
  ApiBody,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiSecurity,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger'
import { SkipThrottle } from '@nestjs/throttler'

import {
  AdminCsrfGuard,
  AdminSessionGuard,
} from '../../../shared/infrastructure/auth/session.guards'
import { ApiProblemResponses, schemaRef } from '../../../shared/infrastructure/http/openapi'
import { CreateComboCommand } from '../application/commands/create-combo.command'
import { DeleteComboCommand } from '../application/commands/delete-combo.command'
import { ReorderCombosCommand } from '../application/commands/reorder-combos.command'
import { UpdateComboCommand } from '../application/commands/update-combo.command'
import { ListAdminCombosQuery } from '../application/queries/list-admin-combos.query'
import type { ComboView } from '../application/read-models'
import { ComboDto, ComboItemDto } from './dto/catalog.response.dto'
import { ComboInputDto, ComboOrderInputDto } from './dto/combo-input.dto'

/** Seguridad de las escrituras del dashboard: sesión de admin y token CSRF. */
const SESSION_AND_CSRF = { adminSession: [], csrfToken: [] }

/** Parámetro `{id}` de un combo (`AdminComboId` del contrato). */
const COMBO_ID_PARAM = {
  name: 'id',
  description: 'Identificador de un combo.',
  schema: { type: 'string', minLength: 1, maxLength: 80 },
} as const

/**
 * Combos del dashboard (`/admin/combos`): listado, alta, edición, borrado y orden. Las lecturas
 * piden la sesión de admin (401 sin ella) y las escrituras, además, el token CSRF (403). Cada
 * escritura avisa a la tienda que cambiaron los combos (evento `combo.changed` en el outbox, en la
 * misma transacción); un 4xx no avisa nada.
 *
 * El id llega tal cual: uno que no existe (o que no es un UUID) responde 404 "No existe ese
 * combo.". El `ValidationPipe` corre antes que el caso de uso, así que un `PATCH` con un cuerpo
 * inválido a un id que no existe responde 422 (Ruling B-63).
 */
@ApiTags('admin')
@ApiExtraModels(ComboDto, ComboItemDto, ComboInputDto, ComboOrderInputDto)
@SkipThrottle()
@Controller('admin/combos')
export class AdminCombosController {
  /**
   * @param listAdminCombos - Query del listado del dashboard.
   * @param createCombo - Alta.
   * @param updateCombo - Edición.
   * @param deleteCombo - Borrado.
   * @param reorderCombos - Orden.
   */
  constructor(
    private readonly listAdminCombos: ListAdminCombosQuery,
    private readonly createCombo: CreateComboCommand,
    private readonly updateCombo: UpdateComboCommand,
    private readonly deleteCombo: DeleteComboCommand,
    private readonly reorderCombos: ReorderCombosCommand,
  ) {}

  /**
   * Lista todos los combos, borradores incluidos, por `position`.
   *
   * @returns Los combos con la forma `Combo` del contrato.
   */
  @Get()
  @UseGuards(AdminSessionGuard)
  @ApiCookieAuth('adminSession')
  @ApiOperation({ operationId: 'listAdminCombos', summary: 'Listar los combos del dashboard' })
  @ApiOkResponse({
    description: 'Combos.',
    schema: {
      type: 'array',
      description: 'Combos ordenados por `position`.',
      items: { $ref: getSchemaPath(ComboDto) },
    },
  })
  @ApiProblemResponses(401, 429, 500)
  list(): Promise<ComboView[]> {
    return this.listAdminCombos.execute()
  }

  /**
   * Crea un combo al final del listado.
   *
   * @param body - Combo ya validado en su forma (422 si no).
   * @returns El combo creado (201).
   */
  @Post()
  @UseGuards(AdminSessionGuard, AdminCsrfGuard)
  @ApiSecurity(SESSION_AND_CSRF)
  @ApiOperation({ operationId: 'createAdminCombo', summary: 'Crear un combo' })
  @ApiBody({ required: true, schema: schemaRef('ComboInput') })
  @ApiCreatedResponse({ schema: schemaRef('Combo'), description: 'Combo creado.' })
  @ApiProblemResponses(401, 403, 422, 429, 500)
  create(@Body() body: ComboInputDto): Promise<ComboView> {
    return this.createCombo.execute(body.toFields())
  }

  /**
   * Fija el orden de los combos: `ids` trae todos, una vez cada uno.
   *
   * @param body - Orden nuevo ya validado en su forma.
   */
  @Put('order')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(AdminSessionGuard, AdminCsrfGuard)
  @ApiSecurity(SESSION_AND_CSRF)
  @ApiOperation({ operationId: 'reorderAdminCombos', summary: 'Reordenar los combos' })
  @ApiBody({ required: true, schema: schemaRef('ComboOrderInput') })
  @ApiNoContentResponse({ description: 'Orden guardado.' })
  @ApiProblemResponses(401, 403, 422, 429, 500)
  async reorder(@Body() body: ComboOrderInputDto): Promise<void> {
    await this.reorderCombos.execute(body.ids)
  }

  /**
   * Reemplaza los datos editables del combo; conserva su `position`.
   *
   * @param id - Id del combo.
   * @param body - Combo completo ya validado en su forma.
   * @returns El combo modificado.
   */
  @Patch(':id')
  @UseGuards(AdminSessionGuard, AdminCsrfGuard)
  @ApiSecurity(SESSION_AND_CSRF)
  @ApiOperation({ operationId: 'updateAdminCombo', summary: 'Modificar un combo' })
  @ApiParam(COMBO_ID_PARAM)
  @ApiBody({ required: true, schema: schemaRef('ComboInput') })
  @ApiOkResponse({ schema: schemaRef('Combo'), description: 'Combo modificado.' })
  @ApiProblemResponses(401, 403, 404, 422, 429, 500)
  update(@Param('id') id: string, @Body() body: ComboInputDto): Promise<ComboView> {
    return this.updateCombo.execute(id, body.toFields())
  }

  /**
   * Borra el combo y renumera los demás. El `422` está declarado porque el contrato lo declara,
   * aunque esta ruta nunca lo devuelve.
   *
   * @param id - Id del combo.
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(AdminSessionGuard, AdminCsrfGuard)
  @ApiSecurity(SESSION_AND_CSRF)
  @ApiOperation({ operationId: 'deleteAdminCombo', summary: 'Borrar un combo' })
  @ApiParam(COMBO_ID_PARAM)
  @ApiNoContentResponse({ description: 'Combo borrado.' })
  @ApiProblemResponses(401, 403, 404, 422, 429, 500)
  async remove(@Param('id') id: string): Promise<void> {
    await this.deleteCombo.execute(id)
  }
}
