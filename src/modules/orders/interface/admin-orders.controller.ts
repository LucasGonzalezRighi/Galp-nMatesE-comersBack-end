import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common'
import {
  ApiBody,
  ApiCookieAuth,
  ApiExtraModels,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger'
import { SkipThrottle } from '@nestjs/throttler'

import {
  AdminCsrfGuard,
  AdminSessionGuard,
} from '../../../shared/infrastructure/auth/session.guards'
import { AddressInputDto } from '../../../shared/infrastructure/http/address-input.dto'
import { ApiProblemResponses, schemaRef } from '../../../shared/infrastructure/http/openapi'
import { ChangeOrderStatusCommand } from '../application/commands/change-order-status.command'
import { GetAdminOrderQuery } from '../application/queries/get-admin-order.query'
import { ListAdminOrdersQuery } from '../application/queries/list-admin-orders.query'
import type { AdminOrderPageView, OrderView } from '../application/read-models'
import { AdminOrdersQueryDto } from './dto/admin-orders.query.dto'
import { OrderNumberParamDto } from './dto/order-number.param'
import { OrderStatusChangeDto } from './dto/order-status-change.dto'
import { OrderDto, OrderTrackingDto, PaymentChallengeDto } from './dto/orders.response.dto'
import { ORDER_NUMBER_PARAM } from './orders-http'

/** Seguridad de las escrituras del dashboard: sesión de admin y token CSRF. */
const SESSION_AND_CSRF = { adminSession: [], csrfToken: [] }

/**
 * Parámetro `status` del listado: se repite para pedir varios (`style: form`, `explode: true`,
 * como lo arma `openapi-fetch` del dashboard).
 */
const STATUS_QUERY = {
  name: 'status',
  required: false,
  style: 'form',
  explode: true,
  description:
    'Estados del pedido; deja solo los pedidos que están en alguno de ellos. Se repite para pedir varios: `?status=paid&status=preparing` son los pedidos para despachar.',
  schema: { type: 'array', items: schemaRef('OrderStatus') },
} as const

/**
 * Pedidos del dashboard (`/admin/orders`): listado con filtros de a 20, detalle y cambio de
 * estado. Las lecturas piden la sesión de admin (401 sin ella) y el cambio, además, el token
 * CSRF (403). Sin límite por IP, como todo menos `POST /orders` (Ruling B-27).
 *
 * El número llega validado por el pipe (422 si no es `GLP-` y cinco dígitos); uno que no existe
 * responde 404 "No existe ese pedido.". El pipe corre antes que el caso de uso, así que un cuerpo
 * inválido a un número que no existe responde 422 (Ruling B-80).
 */
@ApiTags('admin')
@ApiExtraModels(OrderDto, AddressInputDto, OrderTrackingDto, PaymentChallengeDto)
@SkipThrottle()
@Controller('admin/orders')
export class AdminOrdersController {
  /**
   * @param listAdminOrders - Listado.
   * @param getAdminOrder - Detalle.
   * @param changeOrderStatus - Cambio de estado.
   */
  constructor(
    private readonly listAdminOrders: ListAdminOrdersQuery,
    private readonly getAdminOrder: GetAdminOrderQuery,
    private readonly changeOrderStatus: ChangeOrderStatusCommand,
  ) {}

  /**
   * Lista los pedidos del más nuevo al más viejo, de a 20 (vence antes los atrasados).
   *
   * @param query - Página y filtros, ya validados.
   * @returns La página (`AdminOrderPage`); fuera de rango, `items` vacío con el total real.
   */
  @Get()
  @UseGuards(AdminSessionGuard)
  @ApiCookieAuth('adminSession')
  @ApiOperation({ operationId: 'listAdminOrders', summary: 'Listar los pedidos' })
  @ApiQuery(STATUS_QUERY)
  @ApiOkResponse({ schema: schemaRef('AdminOrderPage'), description: 'Página de pedidos.' })
  @ApiProblemResponses(401, 422, 429, 500)
  list(@Query() query: AdminOrdersQueryDto): Promise<AdminOrderPageView> {
    return this.listAdminOrders.execute({
      page: query.page,
      statuses: query.status ?? [],
      paymentStatus: query.paymentStatus ?? null,
      q: query.q ?? null,
    })
  }

  /**
   * Devuelve el pedido completo, con su historial y los datos del pago.
   *
   * @param params - Número del pedido, ya validado.
   * @returns El pedido (vencido si ya correspondía).
   */
  @Get(':number')
  @UseGuards(AdminSessionGuard)
  @ApiCookieAuth('adminSession')
  @ApiOperation({ operationId: 'getAdminOrder', summary: 'Obtener un pedido del dashboard' })
  @ApiParam(ORDER_NUMBER_PARAM)
  @ApiOkResponse({ schema: schemaRef('Order'), description: 'Pedido.' })
  @ApiProblemResponses(401, 404, 422, 429, 500)
  get(@Param() params: OrderNumberParamDto): Promise<OrderView> {
    return this.getAdminOrder.execute(params.number)
  }

  /**
   * Mueve el pedido a `preparing`, `shipped`, `delivered` o `cancelled` (409 si no puede).
   *
   * @param params - Número del pedido, ya validado.
   * @param body - Cambio ya validado y recortado.
   * @returns El pedido con el estado nuevo.
   */
  @Post(':number/status')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdminSessionGuard, AdminCsrfGuard)
  @ApiSecurity(SESSION_AND_CSRF)
  @ApiOperation({ operationId: 'changeOrderStatus', summary: 'Cambiar el estado de un pedido' })
  @ApiParam(ORDER_NUMBER_PARAM)
  @ApiBody({ required: true, schema: schemaRef('OrderStatusChange') })
  @ApiOkResponse({ schema: schemaRef('Order'), description: 'Pedido con el estado nuevo.' })
  @ApiProblemResponses(401, 403, 404, 409, 422, 429, 500)
  change(
    @Param() params: OrderNumberParamDto,
    @Body() body: OrderStatusChangeDto,
  ): Promise<OrderView> {
    return this.changeOrderStatus.execute(params.number, body.toInput())
  }
}
