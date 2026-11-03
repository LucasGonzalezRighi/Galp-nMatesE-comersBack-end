import type { OrderForPayment } from '../../../orders/application/ports/order-payments.port'
import type { InstallmentOption } from '../../domain/installments'
import type { ProviderPayment } from '../../domain/provider-payment'

/** Datos para crear una preferencia de Checkout Pro (Ruling B-35). */
export interface PreferenceInput {
  /** Pedido a cobrar. */
  order: OrderForPayment
  /** Clave idempotente del intento (`X-Idempotency-Key`). */
  idempotencyKey: string
  /** `notification_url` (solo en `live`), o `null`. */
  notificationUrl: string | null
  /** `back_urls` (las tres): `${STORE_ORIGIN}/checkout/resultado?pedido=<número>`. */
  backUrl: string
  /** `expiration_date_to` (el `reservedUntil` del pedido). */
  expiresAt: Date
  /** `statement_descriptor`. */
  statementDescriptor: string
}

/** Preferencia creada. */
export interface PreferenceResult {
  /** Id de la preferencia en Mercado Pago (`sim-pref-…` en el simulador). */
  preferenceId: string
  /** Dirección a la que la tienda redirige para pagar. */
  initPoint: string
}

/** Datos para cobrar con tarjeta (Checkout API, Ruling B-35). */
export interface CardChargeInput {
  /** Pedido a cobrar (`transaction_amount` = `totalArs`). */
  order: OrderForPayment
  /** Clave idempotente del intento (`X-Idempotency-Key`). */
  idempotencyKey: string
  /** Token de la tarjeta (de un solo uso; nunca se loguea). */
  token: string
  /** Marca (`visa`, `master`…). */
  paymentMethodId: string
  /** Banco emisor, o `null`. */
  issuerId: string | null
  /** Cuotas elegidas. */
  installments: number
  /** Pagador. */
  payer: { email: string; identification: { type: string; number: string } }
  /** `notification_url` (solo en `live`), o `null`. */
  notificationUrl: string | null
  /** `statement_descriptor`. */
  statementDescriptor: string
}

/** Consulta de cuotas para una tarjeta. */
export interface InstallmentsRequest {
  /** Primeros 6 a 8 dígitos de la tarjeta. */
  bin: string
  /** Crédito o débito (débito: solo 1 pago). */
  paymentTypeId: 'credit_card' | 'debit_card'
  /** Total del pedido, en pesos (nunca un monto del front). */
  amountArs: number
  /** Máximo sin interés de los ajustes (lo usa el simulador). */
  maxWithoutInterest: number
}

/** Resultado de una devolución. */
export interface RefundResult {
  /** Id de la devolución en Mercado Pago. */
  providerRefundId: string
  /** Estado de la devolución. */
  status: 'approved' | 'pending'
}

/**
 * Pasarela de pagos: `MercadoPagoGateway` (SDK) o `SimulatedGateway` según `MP_MODE`. Traduce sus
 * errores: token inválido → `InvalidCardTokenError`, cuotas no ofrecidas en el simulador →
 * `InstallmentsNotAvailableError`, cualquier otro → `PaymentGatewayError`.
 */
export interface PaymentGatewayPort {
  /**
   * Crea la preferencia de Checkout Pro.
   *
   * @param input - Pedido y datos de la preferencia.
   * @returns Id e `initPoint`.
   */
  createPreference(input: PreferenceInput): Promise<PreferenceResult>
  /**
   * Vence una preferencia (`expires: true` con `expiration_date_to` en el pasado).
   *
   * @param preferenceId - Id de la preferencia.
   */
  expirePreference(preferenceId: string): Promise<void>
  /**
   * Cobra con tarjeta.
   *
   * @param input - Token, cuotas y pagador.
   * @returns El pago tal como quedó (aprobado, pendiente, con desafío o rechazado).
   */
  createCardPayment(input: CardChargeInput): Promise<ProviderPayment>
  /**
   * Consulta un pago.
   *
   * @param providerPaymentId - Id del pago en Mercado Pago.
   * @returns El pago, o `null` si no existe.
   */
  getPayment(providerPaymentId: string): Promise<ProviderPayment | null>
  /**
   * Cancela un pago pendiente (`PUT /v1/payments/{id}` con `status: cancelled`).
   *
   * @param providerPaymentId - Id del pago en Mercado Pago.
   * @returns El pago como quedó, o `null` si no existe.
   */
  cancelPayment(providerPaymentId: string): Promise<ProviderPayment | null>
  /**
   * Devuelve un pago completo.
   *
   * @param providerPaymentId - Id del pago en Mercado Pago.
   * @param idempotencyKey - Clave propia de la devolución (`X-Idempotency-Key`).
   * @returns Id y estado de la devolución.
   */
  refundPayment(providerPaymentId: string, idempotencyKey: string): Promise<RefundResult>
  /**
   * Opciones de cuotas para una tarjeta, de menos a más cuotas (la primera es 1 pago).
   *
   * @param input - BIN, tipo, monto y máximo sin interés.
   * @returns Las opciones.
   */
  getInstallments(input: InstallmentsRequest): Promise<InstallmentOption[]>
}

/** Token de inyección del {@link PaymentGatewayPort}. */
export const PAYMENT_GATEWAY_PORT = Symbol('PAYMENT_GATEWAY_PORT')
