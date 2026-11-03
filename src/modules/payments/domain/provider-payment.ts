import type { PaymentStatus } from '../../orders/domain/order-status'
import { assertPaymentStatus } from './payment-attempt'

/** Un pago tal como lo informa la pasarela (respuesta inmediata, consulta o simulador). */
export interface ProviderPayment {
  /** Id del pago en Mercado Pago (10 dígitos en el simulador). */
  providerPaymentId: string
  /** `status` crudo de Mercado Pago (`approved`, `pending`, `in_process`…). */
  status: string
  /** `status_detail` crudo, o `null`. */
  statusDetail: string | null
  /** `transaction_amount`, en pesos. */
  amountArs: number
  /** `transaction_amount_refunded`, en pesos. */
  refundedArs: number
  /** Cuotas. */
  installments: number | null
  /** `payment_type_id`. */
  paymentTypeId: string | null
  /** `payment_method_id` (la marca de la tarjeta). */
  paymentMethodId: string | null
  /** `card.last_four_digits`. */
  cardLastFour: string | null
  /** `issuer_id`. */
  issuerId: string | null
  /** `external_reference` (el número de pedido). */
  externalReference: string | null
  /** `three_ds_info.external_resource_url`, o `null`. */
  challengeUrl: string | null
  /** `date_approved`, o `null`. */
  approvedAt: Date | null
}

/** Estados crudos de pago que documenta Mercado Pago. */
export const KNOWN_PROVIDER_STATUSES = [
  'pending',
  'approved',
  'authorized',
  'in_process',
  'in_mediation',
  'rejected',
  'cancelled',
  'refunded',
  'charged_back',
] as const

/**
 * Estados que no retroceden: un pago así no vuelve a `pending`, `rejected` ni `cancelled` por una
 * notificación vieja; solo avanza a devolución, disputa o contracargo.
 */
export const FINAL_PAYMENT_STATUSES = [
  'approved',
  'refunded',
  'partially_refunded',
  'in_dispute',
  'charged_back',
] as const satisfies readonly PaymentStatus[]

/** Mapeo directo de los estados crudos que no dependen del detalle ni de los montos. */
const DIRECT_STATUSES: Readonly<Record<string, PaymentStatus>> = {
  rejected: 'rejected',
  cancelled: 'cancelled',
  refunded: 'refunded',
  in_mediation: 'in_dispute',
  charged_back: 'charged_back',
}

/** Estados crudos de un pago que todavía no terminó. */
const PENDING_STATUSES: readonly string[] = ['pending', 'in_process', 'authorized']

function assertAmount(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} tiene que ser un número no negativo (llegó ${String(value)})`)
  }
}

/**
 * Indica si Mercado Pago documenta un `status` (los desconocidos se tratan como `pending`).
 *
 * @param status - `status` crudo.
 * @returns `true` si está en {@link KNOWN_PROVIDER_STATUSES}.
 */
export function isKnownProviderStatus(status: string): boolean {
  return (KNOWN_PROVIDER_STATUSES as readonly string[]).includes(status)
}

/**
 * Traduce el estado de Mercado Pago a {@link PaymentStatus} (Ruling B-39): `approved` →
 * `approved` (o `partially_refunded` con algo devuelto, `refunded` si se devolvió todo);
 * `pending`/`in_process`/`authorized` → `pending`, salvo `pending_challenge` → `action_required`;
 * `rejected`, `cancelled` y `refunded` igual; `in_mediation` → `in_dispute`; `charged_back` igual;
 * cualquier otro → `pending` (quien llama lo loguea).
 *
 * @param payment - Estado, detalle y montos del pago.
 * @returns El estado normalizado.
 * @throws {RangeError} En español, si un monto es negativo o no es un número.
 */
export function normalizePaymentStatus(
  payment: Pick<ProviderPayment, 'status' | 'statusDetail' | 'refundedArs' | 'amountArs'>,
): PaymentStatus {
  assertAmount(payment.amountArs, 'El monto del pago')
  assertAmount(payment.refundedArs, 'El monto devuelto')
  if (payment.status === 'approved') {
    if (payment.refundedArs <= 0) return 'approved'
    return payment.refundedArs >= payment.amountArs ? 'refunded' : 'partially_refunded'
  }
  if (PENDING_STATUSES.includes(payment.status)) {
    return payment.statusDetail === 'pending_challenge' ? 'action_required' : 'pending'
  }
  return DIRECT_STATUSES[payment.status] ?? 'pending'
}

/**
 * Indica si un estado es final (no retrocede a `pending`/`rejected`).
 *
 * @param status - Estado normalizado.
 * @returns `true` para `approved`, `refunded`, `partially_refunded`, `in_dispute` y `charged_back`.
 * @throws {TypeError} En español, si el estado no es del contrato.
 */
export function isFinalStatus(status: PaymentStatus): boolean {
  assertPaymentStatus(status)
  return (FINAL_PAYMENT_STATUSES as readonly PaymentStatus[]).includes(status)
}
