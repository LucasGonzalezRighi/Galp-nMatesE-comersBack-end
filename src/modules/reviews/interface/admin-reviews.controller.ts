import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common'
import {
  ApiBody,
  ApiCookieAuth,
  ApiExtraModels,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger'

import {
  AdminCsrfGuard,
  AdminSessionGuard,
} from '../../../shared/infrastructure/auth/session.guards'
import { ApiProblemResponses, schemaRef } from '../../../shared/infrastructure/http/openapi'
import { ModerateReviewCommand } from '../application/commands/moderate-review.command'
import { ListAdminReviewsQuery } from '../application/queries/list-admin-reviews.query'
import type { AdminReview, AdminReviewPage } from '../application/read-models'
import { AdminReviewsQueryDto, AdminReviewUpdateDto } from './dto/admin-reviews.dto'
import { AdminReviewPageDto } from './dto/reviews.response.dto'

/** Seguridad de las escrituras del dashboard: sesión de admin y token CSRF. */
const SESSION_AND_CSRF = { adminSession: [], csrfToken: [] }

/** Parámetro `{id}` de una reseña (`ReviewId` del contrato). */
const REVIEW_ID_PARAM = {
  name: 'id',
  description: 'Identificador de una reseña.',
  schema: { type: 'string', minLength: 1, maxLength: 80 },
} as const

/**
 * Moderación del dashboard (`/admin/reviews`): listado en cualquier estado y aprobar, ocultar,
 * dejar pendiente o destacar. La lectura pide la sesión de admin (401) y la escritura, además, el
 * token CSRF (403). Cada moderación le avisa a la tienda (`storefront.stale` en la misma
 * transacción) y sube la versión de la caché del catálogo; un 4xx no avisa nada.
 *
 * El id llega tal cual: uno que no existe (o que no es un UUID) responde 404 "No existe esa
 * reseña."; el pipe corre antes, así que un cuerpo inválido a un id que no existe da 422 (Ruling
 * B-80).
 */
@ApiTags('admin')
@ApiExtraModels(AdminReviewPageDto)
@Controller('admin/reviews')
export class AdminReviewsController {
  /**
   * @param listAdminReviews - Listado del dashboard.
   * @param moderateReview - Moderación.
   */
  constructor(
    private readonly listAdminReviews: ListAdminReviewsQuery,
    private readonly moderateReview: ModerateReviewCommand,
  ) {}

  /**
   * Lista las reseñas en cualquier estado, de la más nueva a la más vieja, de a 20.
   *
   * @param query - Página y estado, ya validados.
   * @returns La página con la forma `AdminReviewPage` del contrato.
   */
  @Get()
  @UseGuards(AdminSessionGuard)
  @ApiCookieAuth('adminSession')
  @ApiOperation({ operationId: 'listAdminReviews', summary: 'Listar las reseñas' })
  @ApiOkResponse({ type: AdminReviewPageDto, description: 'Página de reseñas.' })
  @ApiProblemResponses(401, 422, 429, 500)
  list(@Query() query: AdminReviewsQueryDto): Promise<AdminReviewPage> {
    return this.listAdminReviews.execute(query.status, query.page)
  }

  /**
   * Cambia el estado de la reseña o si es destacada; solo lo que viene en el cuerpo.
   *
   * @param id - Id de la reseña.
   * @param body - Cambio ya validado (al menos un campo).
   * @returns La reseña como quedó.
   */
  @Patch(':id')
  @UseGuards(AdminSessionGuard, AdminCsrfGuard)
  @ApiSecurity(SESSION_AND_CSRF)
  @ApiOperation({ operationId: 'updateAdminReview', summary: 'Moderar una reseña' })
  @ApiParam(REVIEW_ID_PARAM)
  @ApiBody({ required: true, schema: schemaRef('AdminReviewUpdate') })
  @ApiOkResponse({ schema: schemaRef('AdminReview'), description: 'Reseña modificada.' })
  @ApiProblemResponses(401, 403, 404, 422, 429, 500)
  update(@Param('id') id: string, @Body() body: AdminReviewUpdateDto): Promise<AdminReview> {
    return this.moderateReview.execute(id, { status: body.status, featured: body.featured })
  }
}
