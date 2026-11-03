import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common'
import {
  ApiCreatedResponse,
  ApiExtraModels,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger'
import { SkipThrottle } from '@nestjs/throttler'

import type { SessionRecord } from '../../../shared/application/ports/session.port'
import {
  OptionalCustomerSessionGuard,
  OptionalSession,
} from '../../../shared/infrastructure/auth/optional-session.guard'
import { AddressInputDto } from '../../../shared/infrastructure/http/address-input.dto'
import { ApiProblemResponses } from '../../../shared/infrastructure/http/openapi'
import { Idempotent } from '../../../shared/infrastructure/idempotency/idempotency.interceptor'
import { CreateOrderCommand } from '../application/commands/create-order.command'
import { GetOrderQuery } from '../application/queries/get-order.query'
import type { CreateOrderResultView, OrderView } from '../application/read-models'
import { CreateOrderInputDto } from './dto/create-order-input.dto'
import { OrderNumberParamDto } from './dto/order-number.param'
import {
  CreateOrderResultDto,
  OrderDto,
  OrderTrackingDto,
  PaymentChallengeDto,
} from './dto/orders.response.dto'
import {
  customerIdOrNull,
  IDEMPOTENCY_KEY_PARAM,
  ORDER_NUMBER_PARAM,
  OrderTokenHeader,
} from './orders-http'

/**
 * Pedidos de la tienda (`/orders`): la creación, idempotente y sin CSRF (`security: []`; un
 * `X-CSRF-Token` que llegue se ignora), y la lectura por `X-Order-Token` o por la sesión del
 * dueño. Las dos leen la cookie del cliente con un guard opcional: sin cookie (o con una sesión
 * que no es de cliente) se compra como invitado; con cookie y Redis caído, 503. Solo la creación
 * conserva el límite global por IP (Ruling B-27).
 */
@ApiTags('orders')
@ApiExtraModels(AddressInputDto, OrderTrackingDto, PaymentChallengeDto)
@SkipThrottle()
@Controller('orders')
export class OrdersController {
  /**
   * @param createOrder - Creación del pedido.
   * @param getOrder - Lectura por token o por sesión.
   */
  constructor(
    private readonly createOrder: CreateOrderCommand,
    private readonly getOrder: GetOrderQuery,
  ) {}

  /**
   * Crea el pedido con el stock reservado 30 minutos. Con la misma `Idempotency-Key` y el mismo
   * cuerpo devuelve el pedido ya creado (con su token); con otro cuerpo, 422.
   *
   * @param body - Pedido del checkout, ya validado.
   * @param session - Sesión del cliente, o `null` si compra como invitado.
   * @returns El pedido y su `orderToken`, que solo viaja en esta respuesta.
   * @throws {OrderConflictError} 409 si cambió el stock, un precio o el total.
   * @throws {CartValidationError} 422 si el envío está deshabilitado o un mate llega sin opciones.
   */
  @Post()
  @SkipThrottle({ default: false })
  @Idempotent('orders')
  @UseGuards(OptionalCustomerSessionGuard)
  @ApiOperation({ operationId: 'createOrder', summary: 'Crear un pedido' })
  @ApiHeader(IDEMPOTENCY_KEY_PARAM)
  @ApiCreatedResponse({
    type: CreateOrderResultDto,
    description: 'Pedido creado, con el token para consultarlo y pagarlo.',
  })
  @ApiProblemResponses(409, 422, 429, 500)
  create(
    @Body() body: CreateOrderInputDto,
    @OptionalSession() session: SessionRecord | null,
  ): Promise<CreateOrderResultView> {
    return this.createOrder.execute(body.toInput(), { customerId: customerIdOrNull(session) })
  }

  /**
   * Devuelve el pedido a quien presenta su token o a la sesión de su dueño, vencido si ya pasó
   * `reservedUntil`. Responde 404 igual si no existe, si el token no corresponde o si la sesión
   * es de otra persona; nunca 401.
   *
   * @param params - Número del pedido, ya validado.
   * @param token - `X-Order-Token`, o `null`.
   * @param session - Sesión del cliente, o `null`.
   * @returns El pedido.
   * @throws {OrderNotFoundError} 404 sin datos.
   */
  @Get(':number')
  @UseGuards(OptionalCustomerSessionGuard)
  @ApiSecurity('orderToken')
  @ApiSecurity('customerSession')
  @ApiOperation({ operationId: 'getOrder', summary: 'Obtener un pedido' })
  @ApiParam(ORDER_NUMBER_PARAM)
  @ApiOkResponse({ type: OrderDto, description: 'Pedido.' })
  @ApiProblemResponses(404, 422, 429, 500)
  get(
    @Param() params: OrderNumberParamDto,
    @OrderTokenHeader() token: string | null,
    @OptionalSession() session: SessionRecord | null,
  ): Promise<OrderView> {
    return this.getOrder.execute(params.number, { token, customerId: customerIdOrNull(session) })
  }
}
