import type { Clock } from '../../../shared/domain/clock'
import { newId } from '../../../shared/domain/id'
import type {
  CardChargeInput,
  InstallmentsRequest,
  PaymentGatewayPort,
  PreferenceInput,
  PreferenceResult,
  RefundResult,
} from '../application/ports/payment-gateway.port'
import type { PaymentsSettings } from '../application/ports/payments-settings.port'
import { type InstallmentOption, simulatedInstallments } from '../domain/installments'
import { InstallmentsNotAvailableError, InvalidCardTokenError } from '../domain/payments-errors'
import type { ProviderPayment } from '../domain/provider-payment'
import {
  newSimulatedPaymentId,
  parseSimulatedToken,
  simulatedOutcome,
} from '../domain/simulated-cards'

/** Ruta de las páginas del simulador (con el prefijo `/api/v1`). */
export const SIMULATOR_PATH = '/api/v1/__simulated/mercadopago'

/** Cuántas llamadas recuerda {@link SimulatedGateway.calls} (las más viejas se descartan). */
export const SIMULATED_CALLS_LIMIT = 500

/** Estados crudos que Mercado Pago deja cancelar (`PUT /v1/payments/{id}`). */
const CANCELLABLE_STATUSES = ['pending', 'in_process', 'authorized']

/** Una llamada a la pasarela simulada. */
export interface SimulatedGatewayCall {
  /** Método llamado. */
  method: keyof PaymentGatewayPort
  /** Argumentos, tal cual. */
  args: unknown[]
}

/**
 * {@link PaymentGatewayPort} sin Mercado Pago (`MP_MODE=simulated`, Ruling B-55), igual que el mock
 * del front: tokens `sim_<TITULAR>_<4|xxxx>_<32 hex>` (otro formato → `InvalidCardTokenError`),
 * resultado según el titular (`APRO`, `CONT`, `OTHE`, `FUND`, `SECU`, `EXPI`, `CALL`, `3DS`; otro →
 * `OTHE`), cuotas de la tabla del mock con el máximo sin interés de los ajustes, preferencias
 * `sim-pref-<uuid>` que abren el checkout simulado del back y desafíos 3-D Secure en la página
 * del simulador.
 *
 * Guarda en memoria cada pago por id (`getPayment` devuelve lo último aplicado: lo que cobró o lo
 * que el simulador resolvió con {@link SimulatedGateway.remember}); `cancelPayment` cancela un
 * pago pendiente y `refundPayment`/`expirePreference` solo responden OK. Como Mercado Pago con el
 * mismo `X-Idempotency-Key`, un cobro o una preferencia con una clave ya usada devuelven el mismo
 * pago (como está ahora) o la misma preferencia, sin cobrar ni crear otra: así el reintento de un
 * cobro que se guardó a medias no cobra dos veces. Cada llamada queda en
 * {@link SimulatedGateway.calls} para los tests.
 */
export class SimulatedGateway implements PaymentGatewayPort {
  /** Llamadas, de la más vieja a la más nueva (como mucho {@link SIMULATED_CALLS_LIMIT}). */
  readonly calls: SimulatedGatewayCall[] = []
  private readonly payments = new Map<string, ProviderPayment>()
  /** Id del pago que cobró cada clave idempotente. */
  private readonly chargedKeys = new Map<string, string>()
  /** Preferencia creada con cada clave idempotente. */
  private readonly preferences = new Map<string, PreferenceResult>()

  /**
   * @param settings - Máximo de cuotas sin interés (`settings.installmentsMax`).
   * @param origin - Origen del back para las páginas del simulador (`PUBLIC_API_ORIGIN` o
   *   `http://localhost:${PORT}`), sin barra final.
   * @param clock - Reloj (`approvedAt` de los pagos aprobados).
   * @param random - Generador de los ids de pago en [0, 1) (por defecto `Math.random`).
   * @throws {TypeError} En español, si el origen no es una URL http(s) sin ruta ni barra final.
   */
  constructor(
    private readonly settings: Pick<PaymentsSettings, 'maxWithoutInterest'>,
    private readonly origin: string,
    private readonly clock: Clock,
    private readonly random: () => number = Math.random,
  ) {
    if (!/^https?:\/\/[^/\s]+$/.test(origin)) {
      throw new TypeError(
        `El origen del simulador tiene que ser una URL http(s) sin ruta ni barra final (llegó "${origin}")`,
      )
    }
  }

  /**
   * @param method - Método.
   * @returns Los argumentos de cada llamada a ese método, en orden.
   */
  callsTo(method: keyof PaymentGatewayPort): unknown[][] {
    return this.calls.filter((call) => call.method === method).map((call) => call.args)
  }

  /**
   * Guarda el pago que resolvió el simulador (lo pasa `SimulateProviderResultCommand`), así
   * `getPayment` lo devuelve como lo haría Mercado Pago después de la notificación.
   *
   * @param payment - Pago aplicado.
   */
  remember(payment: ProviderPayment): void {
    this.payments.set(payment.providerPaymentId, { ...payment })
  }

  /** {@inheritDoc PaymentGatewayPort.createPreference} */
  createPreference(input: PreferenceInput): Promise<PreferenceResult> {
    this.track('createPreference', [input])
    const existing = this.preferences.get(input.idempotencyKey)
    if (existing !== undefined) return Promise.resolve({ ...existing })
    const preferenceId = `sim-pref-${newId()}`
    const preference: PreferenceResult = {
      preferenceId,
      initPoint: `${this.origin}${SIMULATOR_PATH}/checkout?preference=${preferenceId}`,
    }
    this.preferences.set(input.idempotencyKey, preference)
    return Promise.resolve({ ...preference })
  }

  /** {@inheritDoc PaymentGatewayPort.expirePreference} */
  expirePreference(preferenceId: string): Promise<void> {
    this.track('expirePreference', [preferenceId])
    return Promise.resolve()
  }

  /** {@inheritDoc PaymentGatewayPort.validateCardCharge} */
  async validateCardCharge(input: CardChargeInput): Promise<void> {
    this.track('validateCardCharge', [input])
    await this.parseCharge(input)
  }

  /** {@inheritDoc PaymentGatewayPort.createCardPayment} */
  async createCardPayment(input: CardChargeInput): Promise<ProviderPayment> {
    this.track('createCardPayment', [input])
    const charged = this.payments.get(this.chargedKeys.get(input.idempotencyKey) ?? '')
    if (charged !== undefined) return { ...charged }
    const token = await this.parseCharge(input)
    const outcome = simulatedOutcome(token.holder)
    const providerPaymentId = this.newPaymentId()
    const payment: ProviderPayment = {
      providerPaymentId,
      status: outcome.status,
      statusDetail: outcome.statusDetail,
      amountArs: input.order.totalArs,
      refundedArs: 0,
      installments: input.installments,
      paymentTypeId: 'credit_card',
      paymentMethodId: input.paymentMethodId,
      cardLastFour: token.lastFour,
      issuerId: input.issuerId,
      externalReference: input.order.number,
      challengeUrl:
        outcome.statusDetail === 'pending_challenge'
          ? `${this.origin}${SIMULATOR_PATH}/challenge?payment=${providerPaymentId}`
          : null,
      approvedAt: outcome.status === 'approved' ? this.clock.now() : null,
    }
    this.payments.set(providerPaymentId, payment)
    this.chargedKeys.set(input.idempotencyKey, providerPaymentId)
    return { ...payment }
  }

  /** {@inheritDoc PaymentGatewayPort.getPayment} */
  getPayment(providerPaymentId: string): Promise<ProviderPayment | null> {
    this.track('getPayment', [providerPaymentId])
    const payment = this.payments.get(providerPaymentId)
    return Promise.resolve(payment === undefined ? null : { ...payment })
  }

  /** {@inheritDoc PaymentGatewayPort.cancelPayment} */
  cancelPayment(providerPaymentId: string): Promise<ProviderPayment | null> {
    this.track('cancelPayment', [providerPaymentId])
    const payment = this.payments.get(providerPaymentId)
    if (payment === undefined) return Promise.resolve(null)
    if (!CANCELLABLE_STATUSES.includes(payment.status)) return Promise.resolve({ ...payment })
    const cancelled: ProviderPayment = {
      ...payment,
      status: 'cancelled',
      statusDetail: 'by_collector',
      challengeUrl: null,
    }
    this.payments.set(providerPaymentId, cancelled)
    return Promise.resolve({ ...cancelled })
  }

  /** {@inheritDoc PaymentGatewayPort.refundPayment} */
  refundPayment(providerPaymentId: string, idempotencyKey: string): Promise<RefundResult> {
    this.track('refundPayment', [providerPaymentId, idempotencyKey])
    return Promise.resolve({
      providerRefundId: newSimulatedPaymentId(this.random),
      status: 'approved',
    })
  }

  /** {@inheritDoc PaymentGatewayPort.getInstallments} */
  getInstallments(input: InstallmentsRequest): Promise<InstallmentOption[]> {
    this.track('getInstallments', [input])
    return Promise.resolve(
      simulatedInstallments(
        input.amountArs,
        input.maxWithoutInterest,
        input.paymentTypeId === 'credit_card',
      ),
    )
  }

  /**
   * Token y cuotas del cobro: los mismos 422 antes de cancelar el activo y al cobrar.
   *
   * @throws {InvalidCardTokenError} Si el token no es de este simulador.
   * @throws {InstallmentsNotAvailableError} Si las cuotas no están en la tabla del simulador.
   */
  private async parseCharge(
    input: CardChargeInput,
  ): Promise<{ holder: string; lastFour: string | null }> {
    const token = parseSimulatedToken(input.token)
    if (token === null) throw new InvalidCardTokenError()
    const offered = simulatedInstallments(
      input.order.totalArs,
      await this.settings.maxWithoutInterest(),
      true,
    ).map((option) => option.installments)
    if (!offered.includes(input.installments)) throw new InstallmentsNotAvailableError()
    return token
  }

  /** Id de pago de 10 dígitos que todavía no usó. */
  private newPaymentId(): string {
    let id = newSimulatedPaymentId(this.random)
    while (this.payments.has(id)) id = newSimulatedPaymentId(this.random)
    return id
  }

  private track(method: keyof PaymentGatewayPort, args: unknown[]): void {
    this.calls.push({ method, args })
    if (this.calls.length > SIMULATED_CALLS_LIMIT) this.calls.shift()
  }
}
