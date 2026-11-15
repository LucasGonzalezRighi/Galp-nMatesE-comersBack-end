import { Body, Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common'
import {
  ApiBody,
  ApiExtraModels,
  ApiHeader,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger'

import { ApiProblemResponses, schemaRef } from '../../../shared/infrastructure/http/openapi'
import { Idempotent } from '../../../shared/infrastructure/idempotency/idempotency.interceptor'
import { ClientRateLimit } from '../../../shared/infrastructure/throttler/client-rate-limit'
import { OrderNumberParamDto } from '../../orders/interface/dto/order-number.param'
import { PaymentChallengeDto } from '../../orders/interface/dto/orders.response.dto'
import {
  IDEMPOTENCY_KEY_PARAM,
  ORDER_NUMBER_PARAM,
  OrderTokenHeader,
} from '../../orders/interface/orders-http'
import { CancelPaymentCommand } from '../application/commands/cancel-payment.command'
import { CreatePreferenceCommand } from '../application/commands/create-preference.command'
import { PayWithCardCommand } from '../application/commands/pay-with-card.command'
import { GetInstallmentsQuery } from '../application/queries/get-installments.query'
import type {
  CardPaymentResultView,
  InstallmentOption,
  PreferenceView,
} from '../application/read-models'
import { CardPaymentInputDto } from './dto/card-payment-input.dto'
import { InstallmentsInputDto } from './dto/installments-input.dto'
import {
  CardPaymentResultDto,
  InstallmentOptionDto,
  MercadoPagoPreferenceDto,
} from './dto/payments.response.dto'
import { IdempotencyKeyHeader, orderAccess } from './payments-http'

/** Límite de cada ruta de pago (NV-16): 30 pedidos por minuto por IP real del cliente. */
export const PAYMENT_RATE_LIMIT = { ttl: 60_000, limit: 30 } as const

/**
 * Límite de las cuotas (NV-16): 60 pedidos por minuto por IP real del cliente. Es más alto porque
 * la tienda las vuelve a pedir cuando cambia la tarjeta, y cada una llama a Mercado Pago.
 */
export const INSTALLMENTS_RATE_LIMIT = { ttl: 60_000, limit: 60 } as const

/**
 * Pagos de un pedido con Mercado Pago (`/orders/{number}/…`): preferencia de Checkout Pro, tarjeta
 * con 3-D Secure, cuotas y cancelación del intento activo. Solo con `X-Order-Token` (nunca la
 * sesión sola): sin token, con un token ajeno o con un pedido que no existe responden el mismo 404,
 * nunca 401; un `X-CSRF-Token` que llegue se ignora. La preferencia y la tarjeta son idempotentes.
 *
 * Límite por IP real del cliente (`@ClientRateLimit()`, NV-16; antes, sin límite por el Ruling
 * B-52): {@link PAYMENT_RATE_LIMIT} por ruta y {@link INSTALLMENTS_RATE_LIMIT} en las cuotas. Solo
 * cuenta con `TRUST_PROXY` y un cliente conocido: sin él, todo llega con la IP del servidor de la
 * tienda y un límite frenaría a toda la tienda; los pedidos que origina el servidor de la tienda
 * tampoco se cuentan. El webhook de Mercado Pago es otro controlador y sigue sin límite.
 */
@ApiTags('payments')
@ApiExtraModels(InstallmentOptionDto, PaymentChallengeDto)
@ApiSecurity('orderToken')
@ClientRateLimit(PAYMENT_RATE_LIMIT)
@Controller('orders/:number')
export class PaymentsController {
  /**
   * @param createPreference - Preferencia de Checkout Pro.
   * @param payWithCard - Cobro con tarjeta.
   * @param getInstallments - Cuotas de una tarjeta.
   * @param cancelPayment - Cancelación del intento activo.
   */
  constructor(
    private readonly createPreference: CreatePreferenceCommand,
    private readonly payWithCard: PayWithCardCommand,
    private readonly getInstallments: GetInstallmentsQuery,
    private readonly cancelPayment: CancelPaymentCommand,
  ) {}

  /**
   * Crea la preferencia de Checkout Pro (cancela antes el intento activo). Con la misma
   * `Idempotency-Key` devuelve la misma preferencia (también si la primera vez falló después de
   * crear el intento: la retoma).
   *
   * @param params - Número del pedido, ya validado.
   * @param token - `X-Order-Token`, o `null`.
   * @param idempotencyKey - `Idempotency-Key` en minúsculas.
   * @returns El `initPoint` al que redirige la tienda.
   * @throws {OrderNotFoundError} 404 sin token, con token ajeno o sin pedido.
   * @throws {OrderNotPayableError} 409 si el pedido no está `pending_payment`.
   * @throws {IdempotencyKeyReusedError} 422 si la clave es de un intento de otro pedido o de
   *   tarjeta.
   * @throws {PaymentGatewayError} 502 si Mercado Pago falla.
   */
  @Post('payments/mercadopago/preference')
  @HttpCode(HttpStatus.OK)
  @Idempotent('payments')
  @ApiOperation({
    operationId: 'createMercadoPagoPreference',
    summary: 'Crear la preferencia de pago en Mercado Pago',
  })
  @ApiParam(ORDER_NUMBER_PARAM)
  @ApiHeader(IDEMPOTENCY_KEY_PARAM)
  @ApiOkResponse({ type: MercadoPagoPreferenceDto, description: 'Preferencia creada.' })
  @ApiProblemResponses(404, 409, 422, 429, 500)
  preference(
    @Param() params: OrderNumberParamDto,
    @OrderTokenHeader() token: string | null,
    @IdempotencyKeyHeader() idempotencyKey: string,
  ): Promise<PreferenceView> {
    return this.createPreference.execute(orderAccess(params.number, token), idempotencyKey)
  }

  /**
   * Cobra con el token de la tarjeta y aplica la respuesta inmediata (un `APRO` deja el pedido
   * pagado). Con la misma `Idempotency-Key` y el mismo cuerpo devuelve el primer resultado; si la
   * primera vez falló después de cobrar, el reintento retoma ese intento sin cobrar dos veces.
   *
   * @param params - Número del pedido, ya validado.
   * @param token - `X-Order-Token`, o `null`.
   * @param idempotencyKey - `Idempotency-Key` en minúsculas.
   * @param body - Token, marca, banco, cuotas y pagador, ya validados y normalizados.
   * @returns El estado del pago en este momento, con el desafío 3-D Secure si hace falta.
   * @throws {OrderNotFoundError} 404 sin token, con token ajeno o sin pedido.
   * @throws {OrderNotPayableError} 409 si el pedido no está `pending_payment`.
   * @throws {InvalidCardTokenError} 422 en `token`.
   * @throws {InstallmentsNotAvailableError} 422 en `installments`.
   * @throws {IdempotencyKeyReusedError} 422 si la clave es de un intento de otro pedido o de
   *   Checkout Pro.
   * @throws {PaymentGatewayError} 502 si Mercado Pago falla.
   */
  @Post('payments/mercadopago/card')
  @HttpCode(HttpStatus.OK)
  @Idempotent('payments')
  @ApiOperation({ operationId: 'payWithCard', summary: 'Pagar un pedido con tarjeta' })
  @ApiParam(ORDER_NUMBER_PARAM)
  @ApiHeader(IDEMPOTENCY_KEY_PARAM)
  @ApiBody({ type: CardPaymentInputDto })
  @ApiOkResponse({ type: CardPaymentResultDto, description: 'Resultado del intento de pago.' })
  @ApiProblemResponses(404, 409, 422, 429, 500)
  card(
    @Param() params: OrderNumberParamDto,
    @OrderTokenHeader() token: string | null,
    @IdempotencyKeyHeader() idempotencyKey: string,
    @Body() body: CardPaymentInputDto,
  ): Promise<CardPaymentResultView> {
    return this.payWithCard.execute(
      orderAccess(params.number, token),
      body.toInput(),
      idempotencyKey,
    )
  }

  /**
   * Opciones de cuotas para la tarjeta que empieza con `bin`, sobre el total del pedido. Con su
   * propio límite por cliente ({@link INSTALLMENTS_RATE_LIMIT}).
   *
   * @param params - Número del pedido, ya validado.
   * @param token - `X-Order-Token`, o `null`.
   * @param body - BIN y tipo de tarjeta, ya validados.
   * @returns Las opciones, de menos a más cuotas (con débito, solo 1 pago).
   * @throws {OrderNotFoundError} 404 sin token, con token ajeno o sin pedido.
   * @throws {OrderNotPayableError} 409 si el pedido no está `pending_payment`.
   * @throws {PaymentGatewayError} 502 si Mercado Pago falla.
   */
  @Post('payments/mercadopago/installments')
  @HttpCode(HttpStatus.OK)
  @ClientRateLimit(INSTALLMENTS_RATE_LIMIT)
  @ApiOperation({ operationId: 'getInstallments', summary: 'Consultar las cuotas de una tarjeta' })
  @ApiParam(ORDER_NUMBER_PARAM)
  @ApiBody({ type: InstallmentsInputDto })
  @ApiOkResponse({
    description: 'Opciones de cuotas, de menos a más cuotas. La primera es siempre de 1 pago.',
    schema: { type: 'array', minItems: 1, maxItems: 24, items: schemaRef('InstallmentOption') },
  })
  @ApiProblemResponses(404, 409, 422, 429, 500)
  installments(
    @Param() params: OrderNumberParamDto,
    @OrderTokenHeader() token: string | null,
    @Body() body: InstallmentsInputDto,
  ): Promise<InstallmentOption[]> {
    return this.getInstallments.execute(orderAccess(params.number, token), body.toInput())
  }

  /**
   * Cancela el intento de pago activo (el pedido sigue `pending_payment` con su reserva y queda
   * vencible). Responde 204 aunque no hubiera ninguno, así que repetirla no hace daño.
   *
   * @param params - Número del pedido, ya validado.
   * @param token - `X-Order-Token`, o `null`.
   * @throws {OrderNotFoundError} 404 sin token, con token ajeno o sin pedido.
   * @throws {OrderNotPayableError} 409 si el pedido no está `pending_payment`.
   */
  @Post('cancel-payment')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ operationId: 'cancelPayment', summary: 'Cancelar el intento de pago activo' })
  @ApiParam(ORDER_NUMBER_PARAM)
  @ApiNoContentResponse({ description: 'Intento cancelado, o no había ninguno activo.' })
  @ApiProblemResponses(404, 409, 422, 429, 500)
  async cancel(
    @Param() params: OrderNumberParamDto,
    @OrderTokenHeader() token: string | null,
  ): Promise<void> {
    await this.cancelPayment.execute(orderAccess(params.number, token))
  }
}
