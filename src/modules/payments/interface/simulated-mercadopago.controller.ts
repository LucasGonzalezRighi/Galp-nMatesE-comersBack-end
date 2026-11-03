import {
  Body,
  type CanActivate,
  Controller,
  type ExecutionContext,
  Get,
  Inject,
  Injectable,
  NotFoundException,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common'
import { ApiExcludeController } from '@nestjs/swagger'
import { SkipThrottle } from '@nestjs/throttler'

import { ENV, type Env } from '../../../config/env'
import { validationProblem } from '../../../shared/infrastructure/http/validation.pipe'
import {
  ORDER_PAYMENTS_PORT,
  type OrderPaymentsPort,
} from '../../orders/application/ports/order-payments.port'
import { checkoutResultUrl } from '../application/commands/create-preference.command'
import { SimulateProviderResultCommand } from '../application/commands/simulate-provider-result.command'
import {
  PAYMENT_REPOSITORY,
  type PaymentRepository,
} from '../application/ports/payment.repository.port'
import {
  PAYMENTS_SETTINGS,
  type PaymentsSettings,
} from '../application/ports/payments-settings.port'
import { SimulatorResolveInputDto } from './dto/simulator-resolve-input.dto'
import { singleValue } from './payments-http'
import {
  challengeDonePage,
  challengePage,
  checkoutPage,
  invalidLinkPage,
  type SimulatorPage,
} from './simulated-pages'

/** Resultados que vienen de la página del desafío (responden "Listo", no redirigen). */
const CHALLENGE_RESULTS: readonly string[] = ['challenge_ok', 'challenge_failed']

/** Lo que el guard lee de la petición para imitar el 404 de una ruta que no existe. */
interface RouteRequest {
  method: string
  originalUrl: string
}

/** Lo que el controlador usa de la respuesta de Express. */
interface PageResponse {
  status(code: number): this
  setHeader(name: string, value: string): this
  removeHeader(name: string): void
  redirect(status: number, url: string): void
  send(body: string): this
}

/**
 * Si el simulador está prendido: solo con `MP_MODE=simulated` y fuera de producción.
 *
 * @param env - `MP_MODE` y `NODE_ENV`.
 * @returns `true` si las rutas del simulador existen.
 */
export function isSimulatorEnabled(env: Pick<Env, 'MP_MODE' | 'NODE_ENV'>): boolean {
  return env.MP_MODE === 'simulated' && env.NODE_ENV !== 'production'
}

/**
 * Fuera del modo simulado (o en producción) las rutas del simulador responden el mismo 404 que
 * una ruta que no existe (Ruling B-55).
 */
@Injectable()
export class SimulatedModeGuard implements CanActivate {
  /** @param env - `MP_MODE` y `NODE_ENV`. */
  constructor(@Inject(ENV) private readonly env: Pick<Env, 'MP_MODE' | 'NODE_ENV'>) {}

  /**
   * @param context - Contexto de la ruta.
   * @returns `true` si el simulador está prendido.
   * @throws {NotFoundException} 404 `not_found` si no lo está.
   */
  canActivate(context: ExecutionContext): boolean {
    if (isSimulatorEnabled(this.env)) return true
    const req = context.switchToHttp().getRequest<RouteRequest>()
    const path = req.originalUrl.split('?')[0] ?? req.originalUrl
    throw new NotFoundException(`No existe la ruta ${req.method} ${path}.`)
  }
}

/**
 * Simulador de Mercado Pago del back (Ruling B-55): las páginas a las que apuntan el `initPoint`
 * de la preferencia simulada y el `challenge.url` del 3-D Secure simulado, y el `resolve` que
 * aplica el botón elegido como si fuera la notificación de Mercado Pago. Solo existe en
 * `MP_MODE=simulated` fuera de producción, no entra en Swagger y no tiene límite por IP.
 */
@ApiExcludeController()
@SkipThrottle()
@UseGuards(SimulatedModeGuard)
@Controller('__simulated/mercadopago')
export class SimulatedMercadoPagoController {
  /**
   * @param simulate - Aplica el resultado elegido.
   * @param payments - Intentos (para mostrar el pedido de una preferencia).
   * @param orders - Pedidos para pagos (número y total).
   * @param settings - Origen de la tienda.
   */
  constructor(
    private readonly simulate: SimulateProviderResultCommand,
    @Inject(PAYMENT_REPOSITORY) private readonly payments: PaymentRepository,
    @Inject(ORDER_PAYMENTS_PORT) private readonly orders: OrderPaymentsPort,
    @Inject(PAYMENTS_SETTINGS) private readonly settings: PaymentsSettings,
  ) {}

  /**
   * Página de checkout de una preferencia, con el número y el total del pedido.
   *
   * @param preference - Query `preference`.
   * @param res - Respuesta (HTML con su CSP).
   */
  @Get('checkout')
  async checkout(
    @Query('preference') preference: unknown,
    @Res() res: PageResponse,
  ): Promise<void> {
    const preferenceId = singleValue(preference)
    const attempt =
      preferenceId === null
        ? null
        : await this.payments.findByPreferenceId('mercadopago', preferenceId)
    const order = attempt === null ? null : await this.orders.findForPaymentById(attempt.orderId)
    const storeOrigin = this.settings.storeOrigin
    this.sendPage(
      res,
      preferenceId === null || order === null
        ? invalidLinkPage(storeOrigin)
        : checkoutPage({
            preferenceId,
            number: order.number,
            totalArs: order.totalArs,
            storeOrigin,
          }),
    )
  }

  /**
   * Página del desafío 3-D Secure de un pago.
   *
   * @param payment - Query `payment`.
   * @param res - Respuesta (HTML con su CSP).
   */
  @Get('challenge')
  challenge(@Query('payment') payment: unknown, @Res() res: PageResponse): void {
    const providerPaymentId = singleValue(payment)
    const storeOrigin = this.settings.storeOrigin
    this.sendPage(
      res,
      providerPaymentId === null
        ? invalidLinkPage(storeOrigin)
        : challengePage({ providerPaymentId, storeOrigin }),
    )
  }

  /**
   * Aplica el botón elegido: el checkout vuelve a la tienda (`302` a `/checkout/resultado`) y el
   * desafío responde "Listo" y avisa al diálogo de la tienda.
   *
   * @param body - Preferencia o pago, y el resultado.
   * @param res - Respuesta (redirección o HTML).
   * @throws {UnprocessableEntityException} 422 si no viene la preferencia ni el pago.
   * @throws {PaymentAttemptNotFoundError} 404 si no hay un intento con esa preferencia o ese pago.
   * @throws {IntentNotActiveError} 409 `intent_not_active` si el intento ya no está activo.
   */
  @Post('resolve')
  async resolve(@Body() body: SimulatorResolveInputDto, @Res() res: PageResponse): Promise<void> {
    const preferenceId = body.preference ?? null
    const providerPaymentId = body.payment ?? null
    if (preferenceId === null && providerPaymentId === null) {
      throw validationProblem([
        { field: 'preference', code: 'required', message: 'Falta la preferencia o el pago.' },
      ])
    }
    const { number } = await this.simulate.execute({
      preferenceId,
      providerPaymentId,
      result: body.result,
    })
    if (CHALLENGE_RESULTS.includes(body.result)) {
      this.sendPage(res, challengeDonePage(this.settings.storeOrigin))
      return
    }
    res.redirect(302, checkoutResultUrl(this.settings.storeOrigin, number))
  }

  /** Responde una página del simulador con su CSP (la tienda puede embeberla) y sin caché. */
  private sendPage(res: PageResponse, page: SimulatorPage): void {
    res.removeHeader('X-Frame-Options')
    res
      .status(page.status)
      .setHeader('Content-Type', 'text/html; charset=utf-8')
      .setHeader('Cache-Control', 'no-store')
      .setHeader('Content-Security-Policy', page.csp)
      .send(page.html)
  }
}
