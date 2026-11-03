import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common'
import {
  ApiCookieAuth,
  ApiExtraModels,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger'
import { SkipThrottle } from '@nestjs/throttler'

import type { SessionRecord } from '../../../shared/application/ports/session.port'
import { CurrentSession } from '../../../shared/infrastructure/auth/current-session.decorator'
import { customerIdOf } from '../../../shared/infrastructure/auth/session-ids'
import { CustomerSessionGuard } from '../../../shared/infrastructure/auth/session.guards'
import { AddressInputDto } from '../../../shared/infrastructure/http/address-input.dto'
import { ApiProblemResponses } from '../../../shared/infrastructure/http/openapi'
import { GetMyOrderQuery } from '../application/queries/get-my-order.query'
import { ListMyOrdersQuery } from '../application/queries/list-my-orders.query'
import type { OrderSummaryPageView, OrderView } from '../application/read-models'
import { MyOrdersQueryDto } from './dto/my-orders.query.dto'
import { OrderNumberParamDto } from './dto/order-number.param'
import {
  OrderDto,
  OrderSummaryPageDto,
  OrderTrackingDto,
  PaymentChallengeDto,
} from './dto/orders.response.dto'
import { ORDER_NUMBER_PARAM } from './orders-http'

/**
 * "Mis pedidos" (`/me/orders`): los pedidos del cliente con la sesión iniciada, de a 10 y del más
 * nuevo al más viejo, y el detalle de uno suyo (si es de otra persona, 404). Sin sesión, 401. Sin
 * límite por IP (Ruling B-27).
 */
@ApiTags('account')
@ApiCookieAuth('customerSession')
@ApiExtraModels(AddressInputDto, OrderTrackingDto, PaymentChallengeDto)
@UseGuards(CustomerSessionGuard)
@SkipThrottle()
@Controller('me/orders')
export class MyOrdersController {
  /**
   * @param listMyOrders - Página de pedidos del cliente.
   * @param getMyOrder - Un pedido del cliente.
   */
  constructor(
    private readonly listMyOrders: ListMyOrdersQuery,
    private readonly getMyOrder: GetMyOrderQuery,
  ) {}

  /**
   * Lista los pedidos del cliente de a 10 (vence antes los atrasados).
   *
   * @param query - Página pedida, ya validada.
   * @param session - Sesión del cliente.
   * @returns La página (`OrderSummaryPage`); fuera de rango, `items` vacío con el total real.
   */
  @Get()
  @ApiOperation({ operationId: 'listMyOrders', summary: 'Listar mis pedidos' })
  @ApiOkResponse({ type: OrderSummaryPageDto, description: 'Página de pedidos.' })
  @ApiProblemResponses(401, 422, 429, 500)
  list(
    @Query() query: MyOrdersQueryDto,
    @CurrentSession() session: SessionRecord,
  ): Promise<OrderSummaryPageView> {
    return this.listMyOrders.execute(customerIdOf(session), query.page)
  }

  /**
   * Devuelve un pedido del cliente, vencido si ya pasó `reservedUntil`.
   *
   * @param params - Número del pedido, ya validado.
   * @param session - Sesión del cliente.
   * @returns El pedido.
   * @throws {OrderNotFoundError} 404 si no existe o es de otra persona.
   */
  @Get(':number')
  @ApiOperation({ operationId: 'getMyOrder', summary: 'Obtener uno de mis pedidos' })
  @ApiParam(ORDER_NUMBER_PARAM)
  @ApiOkResponse({ type: OrderDto, description: 'Pedido.' })
  @ApiProblemResponses(401, 404, 422, 429, 500)
  get(
    @Param() params: OrderNumberParamDto,
    @CurrentSession() session: SessionRecord,
  ): Promise<OrderView> {
    return this.getMyOrder.execute(customerIdOf(session), params.number)
  }
}
