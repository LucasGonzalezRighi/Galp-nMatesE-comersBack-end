import { Controller, Get, UseGuards } from '@nestjs/common'
import { ApiCookieAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import { SkipThrottle } from '@nestjs/throttler'

import { AdminSessionGuard } from '../../../shared/infrastructure/auth/session.guards'
import { ApiProblemResponses } from '../../../shared/infrastructure/http/openapi'
import {
  type DashboardSummaryView,
  GetDashboardSummaryQuery,
} from '../application/queries/get-dashboard-summary.query'
import { DashboardSummaryDto } from './dto/dashboard-summary.dto'

/**
 * Inicio del dashboard (`GET /admin/dashboard/summary`): ventas, pedidos para despachar, stock
 * bajo, reseñas y mensajes pendientes y alertas de pago. Pide la sesión de admin (401 sin ella).
 * Sin límite por IP, como todo menos `POST /orders` (Ruling B-27). Lee Postgres sin caché.
 */
@ApiTags('admin')
@SkipThrottle()
@Controller('admin/dashboard')
export class AdminDashboardController {
  /** @param getDashboardSummary - Resumen. */
  constructor(private readonly getDashboardSummary: GetDashboardSummaryQuery) {}

  /**
   * Devuelve las cifras del inicio del dashboard.
   *
   * @returns El resumen con la forma `DashboardSummary` del contrato.
   */
  @Get('summary')
  @UseGuards(AdminSessionGuard)
  @ApiCookieAuth('adminSession')
  @ApiOperation({ operationId: 'getDashboardSummary', summary: 'Obtener el resumen del dashboard' })
  @ApiOkResponse({ type: DashboardSummaryDto, description: 'Resumen.' })
  @ApiProblemResponses(401, 429, 500)
  summary(): Promise<DashboardSummaryView> {
    return this.getDashboardSummary.execute()
  }
}
