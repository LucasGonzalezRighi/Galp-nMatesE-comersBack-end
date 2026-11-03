import { randomUUID } from 'node:crypto'

import {
  MercadoPagoConfig,
  MPNotFoundError,
  Payment as MpPayment,
  PaymentRefund,
  Preference,
} from 'mercadopago'

import type { Clock } from '../../../shared/domain/clock'
import type {
  CardChargeInput,
  InstallmentsRequest,
  PaymentGatewayPort,
  PreferenceInput,
  PreferenceResult,
  RefundResult,
} from '../application/ports/payment-gateway.port'
import {
  SILENT_PAYMENTS_LOGGER,
  type PaymentsLogger,
} from '../application/ports/payments-logger.port'
import type { InstallmentOption } from '../domain/installments'
import { PaymentGatewayError } from '../domain/payments-errors'
import type { ProviderPayment } from '../domain/provider-payment'
import {
  describeMercadoPagoError,
  type PreferenceBody,
  toExpiredPreferenceBody,
  toGatewayError,
  toInstallmentOptions,
  toPaymentBody,
  toPreferenceBody,
  toProviderPayment,
} from './mercadopago.mapper'

/** Tiempo máximo de cada llamada a Mercado Pago (SDK y `fetch` de cuotas). */
export const MERCADOPAGO_TIMEOUT_MS = 10_000

/** Origen de la API de Mercado Pago (cuotas; el SDK usa el mismo). */
export const MERCADOPAGO_API_ORIGIN = 'https://api.mercadopago.com'

/** Los clientes del SDK que usa la pasarela (en los specs, dobles). */
export interface MercadoPagoClients {
  /** Preferencias de Checkout Pro. */
  preference: Pick<Preference, 'create' | 'update'>
  /** Pagos de Checkout API. */
  payment: Pick<MpPayment, 'create' | 'get' | 'cancel'>
  /** Devoluciones. */
  refund: Pick<PaymentRefund, 'create'>
}

/**
 * Clientes del SDK `mercadopago` 3.6.1 con el access token y un timeout de
 * {@link MERCADOPAGO_TIMEOUT_MS}.
 *
 * @param accessToken - `MP_ACCESS_TOKEN` (nunca se loguea).
 * @returns Preferencias, pagos y devoluciones.
 * @throws {TypeError} En español, si el access token está vacío.
 */
export function createMercadoPagoClients(accessToken: string): MercadoPagoClients {
  if (accessToken.trim() === '') {
    throw new TypeError('La pasarela de Mercado Pago necesita MP_ACCESS_TOKEN')
  }
  const config = new MercadoPagoConfig({
    accessToken,
    options: { timeout: MERCADOPAGO_TIMEOUT_MS },
  })
  return {
    preference: new Preference(config),
    payment: new MpPayment(config),
    refund: new PaymentRefund(config),
  }
}

/** Configuración de {@link MercadoPagoGateway}. */
export interface MercadoPagoGatewayOptions {
  /** `MP_ACCESS_TOKEN` (para el `fetch` de cuotas; nunca se loguea ni se devuelve). */
  accessToken: string
  /** Reloj (vigencia de las preferencias). */
  clock: Clock
  /** Dónde avisar los errores de Mercado Pago (por defecto, en ningún lado). */
  logger?: PaymentsLogger
  /** `fetch` para las cuotas (por defecto, el global de Node). */
  fetch?: typeof fetch
}

/** Estados de una devolución que todavía puede acreditarse. */
const REFUND_IN_PROGRESS = ['in_process', 'pending', 'authorized']

/**
 * {@link PaymentGatewayPort} contra Mercado Pago (`MP_MODE=live`, Ruling B-34): Checkout Pro con
 * `Preference`, Checkout API con `Payment`, devoluciones con `PaymentRefund` (cada escritura con
 * su `X-Idempotency-Key`) y cuotas con `fetch` a `GET /v1/payment_methods/installments` (el SDK no
 * las tiene).
 *
 * Los errores se traducen (token → `InvalidCardTokenError` 422; el resto → `PaymentGatewayError`
 * 502) y se loguean solo con `status`, `error` y las causas: nunca el token de la tarjeta, el
 * access token ni la respuesta cruda. Un pago que Mercado Pago no tiene (404) da `null`.
 */
export class MercadoPagoGateway implements PaymentGatewayPort {
  private readonly logger: PaymentsLogger
  private readonly fetch: typeof fetch

  /**
   * @param options - Access token, reloj, logger y `fetch`.
   * @param clients - Clientes del SDK (por defecto, los de {@link createMercadoPagoClients}).
   */
  constructor(
    private readonly options: MercadoPagoGatewayOptions,
    private readonly clients: MercadoPagoClients = createMercadoPagoClients(options.accessToken),
  ) {
    this.logger = options.logger ?? SILENT_PAYMENTS_LOGGER
    this.fetch = options.fetch ?? ((input, init) => fetch(input, init))
  }

  /** {@inheritDoc PaymentGatewayPort.createPreference} */
  async createPreference(input: PreferenceInput): Promise<PreferenceResult> {
    const action = `crear la preferencia del pedido ${input.order.number}`
    try {
      const response = await this.clients.preference.create({
        body: toPreferenceBody(input, this.options.clock.now()),
        requestOptions: { idempotencyKey: input.idempotencyKey },
      })
      if (response.id === undefined || response.init_point === undefined) {
        throw new Error('la respuesta no trae id ni init_point')
      }
      return { preferenceId: response.id, initPoint: response.init_point }
    } catch (error: unknown) {
      throw this.fail(action, error)
    }
  }

  /** {@inheritDoc PaymentGatewayPort.expirePreference} */
  async expirePreference(preferenceId: string): Promise<void> {
    try {
      await this.clients.preference.update({
        id: preferenceId,
        // Solo los campos a cambiar: el SDK tipa el cuerpo completo (con `items`).
        updatePreferenceRequest: toExpiredPreferenceBody(
          this.options.clock.now(),
        ) as PreferenceBody,
        // El SDK 3.6.1 guarda las `requestOptions` de cada llamada en el `MercadoPagoConfig`
        // compartido: sin clave propia, este PUT saldría con la del último cobro o devolución y
        // Mercado Pago lo resolvería con esa respuesta guardada (o con 409) sin vencer nada.
        requestOptions: { idempotencyKey: randomUUID() },
      })
    } catch (error: unknown) {
      throw this.fail(`vencer la preferencia ${preferenceId}`, error)
    }
  }

  /** {@inheritDoc PaymentGatewayPort.createCardPayment} */
  async createCardPayment(input: CardChargeInput): Promise<ProviderPayment> {
    try {
      const response = await this.clients.payment.create({
        body: toPaymentBody(input),
        requestOptions: { idempotencyKey: input.idempotencyKey },
      })
      return toProviderPayment(response)
    } catch (error: unknown) {
      throw this.fail(`cobrar con tarjeta el pedido ${input.order.number}`, error)
    }
  }

  /** {@inheritDoc PaymentGatewayPort.getPayment} */
  async getPayment(providerPaymentId: string): Promise<ProviderPayment | null> {
    try {
      return toProviderPayment(await this.clients.payment.get({ id: providerPaymentId }))
    } catch (error: unknown) {
      if (error instanceof MPNotFoundError) return null
      throw this.fail(`consultar el pago ${providerPaymentId}`, error)
    }
  }

  /** {@inheritDoc PaymentGatewayPort.cancelPayment} */
  async cancelPayment(providerPaymentId: string): Promise<ProviderPayment | null> {
    try {
      const response = await this.clients.payment.cancel({
        id: providerPaymentId,
        // Clave propia y nueva (ver `expirePreference`): cancelar el mismo pago dos veces es
        // seguro y no debe heredar la clave del último cobro o devolución.
        requestOptions: { idempotencyKey: randomUUID() },
      })
      return toProviderPayment(response)
    } catch (error: unknown) {
      if (error instanceof MPNotFoundError) return null
      throw this.fail(`cancelar el pago ${providerPaymentId}`, error)
    }
  }

  /**
   * {@inheritDoc PaymentGatewayPort.refundPayment}
   *
   * @throws {Error} En español, si Mercado Pago rechaza o cancela la devolución (el caso de uso
   *   deja la fila `failed` con este mensaje).
   */
  async refundPayment(providerPaymentId: string, idempotencyKey: string): Promise<RefundResult> {
    let response: Awaited<ReturnType<MercadoPagoClients['refund']['create']>>
    try {
      response = await this.clients.refund.create({
        payment_id: providerPaymentId,
        requestOptions: { idempotencyKey },
      })
    } catch (error: unknown) {
      throw this.fail(`devolver el pago ${providerPaymentId}`, error)
    }
    const status = response.status ?? 'pending'
    if (status !== 'approved' && !REFUND_IN_PROGRESS.includes(status)) {
      throw new Error(
        `Mercado Pago rechazó la devolución del pago ${providerPaymentId} (${status})`,
      )
    }
    if (response.id === undefined) {
      throw this.fail(`devolver el pago ${providerPaymentId}`, new Error('la respuesta no trae id'))
    }
    return {
      providerRefundId: String(response.id),
      status: status === 'approved' ? 'approved' : 'pending',
    }
  }

  /** {@inheritDoc PaymentGatewayPort.getInstallments} */
  async getInstallments(input: InstallmentsRequest): Promise<InstallmentOption[]> {
    const url = new URL('/v1/payment_methods/installments', MERCADOPAGO_API_ORIGIN)
    url.searchParams.set('bin', input.bin)
    url.searchParams.set('amount', String(input.amountArs))
    url.searchParams.set('payment_type_id', input.paymentTypeId)
    const action = `consultar las cuotas del BIN ${input.bin}`
    let body: unknown
    try {
      const response = await this.fetch(url, {
        headers: { Authorization: `Bearer ${this.options.accessToken}` },
        signal: AbortSignal.timeout(MERCADOPAGO_TIMEOUT_MS),
      })
      if (!response.ok) throw new Error(`status ${String(response.status)}`)
      body = await response.json()
    } catch (error: unknown) {
      throw this.fail(action, error)
    }
    try {
      return toInstallmentOptions(body, input.paymentTypeId)
    } catch (error: unknown) {
      throw this.fail(action, error)
    }
  }

  /** Avisa el error (sin datos sensibles) y lo traduce al error del dominio. */
  private fail(action: string, error: unknown): Error {
    const translated = toGatewayError(error)
    const verb = translated instanceof PaymentGatewayError ? 'No se pudo' : 'Mercado Pago rechazó'
    this.logger.warn(`${verb} ${action}: ${describeMercadoPagoError(error)}`)
    return translated
  }
}
