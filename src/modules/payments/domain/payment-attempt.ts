import {
  PAYMENT_STATUSES,
  type PaymentMethod,
  type PaymentStatus,
} from '../../orders/domain/order-status'

/**
 * Estados de un intento activo: `none` (preferencia sin pagar o tarjeta en curso), `pending` y
 * `action_required`. Hay uno solo por pedido (Ruling B-44).
 */
export const ACTIVE_PAYMENT_STATUSES = [
  'none',
  'pending',
  'action_required',
] as const satisfies readonly PaymentStatus[]

/**
 * Intentos de pago que puede tener un pedido (filas de `payments`, con los que registra el
 * webhook): el siguiente responde 409 `order_not_payable` sin llamar a Mercado Pago (auditoría
 * NV-16; las rutas de pago no tienen límite de tasa y cada intento gasta cuota de la pasarela).
 */
export const MAX_PAYMENT_ATTEMPTS_PER_ORDER = 10

/** Pasarela de un intento (columna `payments.provider`). */
export type PaymentProvider = 'mercadopago'

/** Motivos de una devolución (enum `refund_reason`). */
export const REFUND_REASONS = ['duplicate_payment', 'late_approval', 'manual'] as const

/**
 * Motivo de una devolución: `duplicate_payment` (segundo pago aprobado de un pedido pagado),
 * `late_approval` (aprobado después de vencer o cancelarse el pedido) o `manual`.
 */
export type RefundReason = (typeof REFUND_REASONS)[number]

/** Un intento de pago de un pedido (una fila de `payments`). */
export interface PaymentAttempt {
  /** Id del intento (uuid v7). */
  id: string
  /** Pedido al que pertenece. */
  orderId: string
  /** Pasarela. */
  provider: PaymentProvider
  /** `mp_redirect` (preferencia de Checkout Pro) o `card` (tarjeta en la tienda). */
  method: PaymentMethod
  /** Estado normalizado. */
  status: PaymentStatus
  /** `status` crudo de Mercado Pago, o `null` si todavía no hay pago. */
  providerStatus: string | null
  /** `status_detail` de Mercado Pago, tal cual. */
  statusDetail: string | null
  /** Id del pago en Mercado Pago. */
  providerPaymentId: string | null
  /** Id de la preferencia de Checkout Pro. */
  providerPreferenceId: string | null
  /** Dirección de pago de la preferencia. */
  initPoint: string | null
  /** Dirección del desafío 3-D Secure, solo mientras está `action_required`. */
  challengeUrl: string | null
  /** Monto del intento, en pesos (el que informa la pasarela cuando hay pago). */
  amountArs: number
  /** Monto devuelto, en pesos. */
  refundedArs: number
  /** Cuotas del pago. */
  installments: number | null
  /** Tipo de medio (`credit_card`, `debit_card`, `account_money`…). */
  paymentTypeId: string | null
  /** Marca de la tarjeta (`payment_method_id` de Mercado Pago). */
  cardBrand: string | null
  /** Últimos 4 dígitos de la tarjeta. */
  cardLastFour: string | null
  /** Banco emisor. */
  issuerId: string | null
  /** Email del pagador (solo tarjeta). */
  payerEmail: string | null
  /** Clave idempotente que se manda a Mercado Pago (`X-Idempotency-Key`). */
  idempotencyKey: string
  /** Si es el intento activo del pedido. */
  isActive: boolean
  /** Cuándo se aprobó, o `null`. */
  approvedAt: Date | null
  /** Creación del intento. */
  createdAt: Date
}

/**
 * Comprueba que un estado sea del contrato.
 *
 * @param status - Estado a comprobar.
 * @throws {TypeError} En español, si no es un {@link PaymentStatus}.
 */
export function assertPaymentStatus(status: PaymentStatus): void {
  if (!(PAYMENT_STATUSES as readonly string[]).includes(status)) {
    throw new TypeError(`El estado del pago "${status}" no es del contrato`)
  }
}

/**
 * Indica si un estado deja el intento activo (Ruling B-44).
 *
 * @param status - Estado normalizado.
 * @returns `true` para `none`, `pending` y `action_required`.
 * @throws {TypeError} En español, si el estado no es del contrato.
 */
export function isActiveStatus(status: PaymentStatus): boolean {
  assertPaymentStatus(status)
  return (ACTIVE_PAYMENT_STATUSES as readonly PaymentStatus[]).includes(status)
}
