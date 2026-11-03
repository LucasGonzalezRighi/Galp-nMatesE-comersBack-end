import type {
  Payment as PaymentRow,
  Prisma,
  Refund as RefundRow,
  WebhookEvent as WebhookEventRow,
} from '../../../generated/prisma/client'
import type { JsonObject } from '../../../shared/domain/domain-event'
import type { PaymentAttemptPatch, Refund } from '../application/ports/payment.repository.port'
import type { StoredWebhookEvent } from '../application/ports/webhook-event.repository.port'
import type { PaymentAttempt } from '../domain/payment-attempt'

/**
 * Fila de `payments` → intento del dominio.
 *
 * @param row - Fila de Prisma.
 * @returns El intento.
 */
export function toPaymentAttempt(row: PaymentRow): PaymentAttempt {
  return {
    id: row.id,
    orderId: row.orderId,
    provider: row.provider,
    method: row.method,
    status: row.status,
    providerStatus: row.providerStatus,
    statusDetail: row.statusDetail,
    providerPaymentId: row.providerPaymentId,
    providerPreferenceId: row.providerPreferenceId,
    initPoint: row.initPoint,
    challengeUrl: row.challengeUrl,
    amountArs: row.amountArs,
    refundedArs: row.refundedArs,
    installments: row.installments,
    paymentTypeId: row.paymentTypeId,
    cardBrand: row.cardBrand,
    cardLastFour: row.cardLastFour,
    issuerId: row.issuerId,
    payerEmail: row.payerEmail,
    idempotencyKey: row.idempotencyKey,
    isActive: row.isActive,
    approvedAt: row.approvedAt,
    createdAt: row.createdAt,
  }
}

/**
 * Parche del dominio → `data` de Prisma, solo con las claves presentes (con
 * `exactOptionalPropertyTypes` una clave ausente no se escribe).
 *
 * @param patch - Cambios del intento.
 * @returns Los datos para `payment.update`.
 */
export function toPaymentUpdate(patch: PaymentAttemptPatch): Prisma.PaymentUncheckedUpdateInput {
  const data: Prisma.PaymentUncheckedUpdateInput = {}
  if (patch.status !== undefined) data.status = patch.status
  if (patch.providerStatus !== undefined) data.providerStatus = patch.providerStatus
  if (patch.statusDetail !== undefined) data.statusDetail = patch.statusDetail
  if (patch.providerPaymentId !== undefined) data.providerPaymentId = patch.providerPaymentId
  if (patch.providerPreferenceId !== undefined) {
    data.providerPreferenceId = patch.providerPreferenceId
  }
  if (patch.initPoint !== undefined) data.initPoint = patch.initPoint
  if (patch.challengeUrl !== undefined) data.challengeUrl = patch.challengeUrl
  if (patch.amountArs !== undefined) data.amountArs = patch.amountArs
  if (patch.refundedArs !== undefined) data.refundedArs = patch.refundedArs
  if (patch.installments !== undefined) data.installments = patch.installments
  if (patch.paymentTypeId !== undefined) data.paymentTypeId = patch.paymentTypeId
  if (patch.cardBrand !== undefined) data.cardBrand = patch.cardBrand
  if (patch.cardLastFour !== undefined) data.cardLastFour = patch.cardLastFour
  if (patch.issuerId !== undefined) data.issuerId = patch.issuerId
  if (patch.isActive !== undefined) data.isActive = patch.isActive
  if (patch.idempotencyKey !== undefined) data.idempotencyKey = patch.idempotencyKey
  if (patch.approvedAt !== undefined) data.approvedAt = patch.approvedAt
  return data
}

/**
 * Fila de `refunds` → devolución del dominio.
 *
 * @param row - Fila de Prisma.
 * @returns La devolución.
 */
export function toRefund(row: RefundRow): Refund {
  return {
    id: row.id,
    paymentId: row.paymentId,
    amountArs: row.amountArs,
    reason: row.reason,
    idempotencyKey: row.idempotencyKey,
    createdAt: row.createdAt,
    providerRefundId: row.providerRefundId,
    status: row.status,
    lastError: row.lastError,
  }
}

/** Indica si un JSON de Prisma es un objeto (el cuerpo de una notificación siempre lo es). */
function isJsonObject(value: Prisma.JsonValue): value is Prisma.JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Fila de `webhook_events` → notificación guardada.
 *
 * @param row - Fila de Prisma.
 * @returns La notificación.
 * @throws {TypeError} En español, si el `payload` guardado no es un objeto JSON.
 */
export function toStoredWebhookEvent(row: WebhookEventRow): StoredWebhookEvent {
  if (!isJsonObject(row.payload)) {
    throw new TypeError(`La notificación ${row.id} tiene un cuerpo que no es un objeto JSON`)
  }
  return {
    id: row.id,
    provider: row.provider,
    eventId: row.eventId,
    type: row.type,
    action: row.action,
    resourceId: row.resourceId,
    signatureValid: row.signatureValid,
    payload: row.payload as JsonObject,
    receivedAt: row.receivedAt,
    processedAt: row.processedAt,
    attempts: row.attempts,
  }
}
