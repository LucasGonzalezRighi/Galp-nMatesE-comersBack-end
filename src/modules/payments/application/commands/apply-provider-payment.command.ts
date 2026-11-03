import type { Clock } from '../../../../shared/domain/clock'
import type { NewDomainEvent } from '../../../../shared/domain/domain-event'
import { newId } from '../../../../shared/domain/id'
import type {
  OrderForPayment,
  OrderPaymentsPort,
} from '../../../orders/application/ports/order-payments.port'
import type { OrderStatus, PaymentStatus } from '../../../orders/domain/order-status'
import {
  isActiveStatus,
  type PaymentAttempt,
  type RefundReason,
} from '../../domain/payment-attempt'
import {
  orderPaidEvent,
  paymentApprovedEvent,
  paymentRefundedEvent,
  paymentRejectedEvent,
} from '../../domain/payment-events'
import {
  isFinalStatus,
  isKnownProviderStatus,
  normalizePaymentStatus,
  type ProviderPayment,
} from '../../domain/provider-payment'
import type { PaymentGatewayPort } from '../ports/payment-gateway.port'
import type { PaymentRepository } from '../ports/payment.repository.port'
import { SILENT_PAYMENTS_LOGGER, type PaymentsLogger } from '../ports/payments-logger.port'
import { errorMessage } from '../release-attempt'

/** De dónde llega el estado que se aplica. */
export type ApplySource = 'card' | 'webhook' | 'simulator' | 'reconcile'

/** Contexto de una aplicación. */
export interface ApplyContext {
  /** Intento al que corresponde, si quien llama lo sabe (tarjeta, simulador, conciliación). */
  attemptId: string | null
  /** Origen (para los avisos). */
  source: ApplySource
}

/** Estados a los que puede avanzar un pago que ya es final. */
const AFTER_FINAL: readonly PaymentStatus[] = [
  'refunded',
  'partially_refunded',
  'in_dispute',
  'charged_back',
]

/** Estados de un intento que cobró (cuenta para "el pedido ya tiene un pago"). */
const PAYING: readonly PaymentStatus[] = [
  'approved',
  'partially_refunded',
  'in_dispute',
  'charged_back',
]

/** Estados del pedido en los que un aprobado nuevo llega tarde. */
const LATE_ORDER: readonly OrderStatus[] = ['expired', 'cancelled', 'refunded']

/**
 * Máquina de estados del pago y del pedido (Ruling B-39): aplica de forma idempotente cualquier
 * estado que llegue de la pasarela (respuesta inmediata de la tarjeta, webhook, simulador o
 * conciliación). Paga el pedido cuando los aprobados cubren el total, devuelve sola un aprobado
 * duplicado o tardío (Ruling B-41) y nunca hace retroceder un pago final.
 *
 * Los efectos sobre el pedido son otra transacción que el cambio del intento. Si se cortan después
 * de guardar el intento `approved`, un aprobado que se repite (reintento del job, conciliación o
 * webhook repetido) los retoma mientras el pedido siga `pending_payment` o sea tardío: `markPaid`
 * es condicional y la devolución es idempotente por `findRefundByPayment`. La regla del duplicado
 * (devolver al segundo aprobado de un pedido ya pagado) solo corre en la primera transición, porque
 * con dos aprobados una repetición no sabe cuál fue el que pagó y devolvería al equivocado.
 */
export class ApplyProviderPaymentCommand {
  /**
   * @param payments - Intentos y devoluciones.
   * @param orders - Escrituras sobre pedidos (`markPaid`, `markRefunded`, `setPaymentStatus`).
   * @param gateway - Pasarela (para devolver).
   * @param clock - Reloj.
   * @param logger - Avisos (estado desconocido, pago sin pedido, devolución fallida).
   */
  constructor(
    private readonly payments: PaymentRepository,
    private readonly orders: OrderPaymentsPort,
    private readonly gateway: PaymentGatewayPort,
    private readonly clock: Clock,
    private readonly logger: PaymentsLogger = SILENT_PAYMENTS_LOGGER,
  ) {}

  /**
   * Localiza el intento (por id de pago, por `attemptId`, por la preferencia activa del pedido de
   * `externalReference` o registrando uno nuevo inactivo) y le aplica el estado.
   *
   * @param payment - El pago como lo informa la pasarela.
   * @param context - Intento conocido y origen.
   * @returns El intento como quedó, o `null` si el pago no es de ningún pedido (se ignora).
   * @throws {TypeError} En español, si el pago no trae id.
   */
  async execute(payment: ProviderPayment, context: ApplyContext): Promise<PaymentAttempt | null> {
    if (payment.providerPaymentId.trim() === '') {
      throw new TypeError('El pago de la pasarela necesita un id')
    }
    if (!isKnownProviderStatus(payment.status)) {
      this.logger.warn(
        `Estado desconocido de Mercado Pago "${payment.status}" en el pago ${payment.providerPaymentId} (${context.source}): se toma como pending`,
      )
    }
    const attempt = await this.locate(payment, context)
    if (attempt === null) {
      this.logger.warn(
        `El pago ${payment.providerPaymentId} de Mercado Pago no es de ningún pedido (external_reference ${String(payment.externalReference)}): se ignora`,
      )
      return null
    }
    const next = normalizePaymentStatus(payment)
    if (isFinalStatus(attempt.status) && !AFTER_FINAL.includes(next)) {
      if (attempt.status === 'approved' && next === 'approved') {
        await this.resumeApproved(attempt, payment)
      }
      return attempt
    }
    const order = await this.orders.findForPaymentById(attempt.orderId)
    if (order === null)
      throw new Error(`El pedido ${attempt.orderId} del intento ${attempt.id} no existe`)
    const now = this.clock.now()
    const transitioned = attempt.status !== next
    const updated = await this.payments.update(
      attempt.id,
      {
        status: next,
        providerStatus: payment.status,
        statusDetail: payment.statusDetail,
        providerPaymentId: payment.providerPaymentId,
        challengeUrl: next === 'action_required' ? payment.challengeUrl : null,
        amountArs: payment.amountArs,
        refundedArs: payment.refundedArs,
        installments: payment.installments,
        paymentTypeId: payment.paymentTypeId,
        cardBrand: payment.paymentMethodId,
        cardLastFour: payment.cardLastFour,
        issuerId: payment.issuerId,
        isActive: attempt.isActive && isActiveStatus(next),
        approvedAt: payment.approvedAt ?? attempt.approvedAt ?? (next === 'approved' ? now : null),
      },
      transitioned ? await this.eventsFor(order, attempt, next, payment) : [],
    )
    if (transitioned) await this.applyToOrder(order, updated, payment, now)
    return updated
  }

  private async locate(
    payment: ProviderPayment,
    context: ApplyContext,
  ): Promise<PaymentAttempt | null> {
    const byPayment = await this.payments.findByProviderPaymentId(
      'mercadopago',
      payment.providerPaymentId,
    )
    if (byPayment !== null) return byPayment
    if (context.attemptId !== null) {
      const byId = await this.payments.findById(context.attemptId)
      if (byId !== null) return byId
    }
    if (payment.externalReference === null) return null
    const order = await this.orders.findForPayment(payment.externalReference)
    if (order === null) return null
    const active = await this.payments.findActiveByOrder(order.id)
    if (active?.method === 'mp_redirect' && active.providerPaymentId === null) return active
    return this.payments.recordAttempt({
      id: newId(),
      orderId: order.id,
      method: 'mp_redirect',
      amountArs: payment.amountArs,
      idempotencyKey: newId(),
      payerEmail: null,
      createdAt: this.clock.now(),
    })
  }

  private async eventsFor(
    order: OrderForPayment,
    attempt: PaymentAttempt,
    next: PaymentStatus,
    payment: ProviderPayment,
  ): Promise<NewDomainEvent[]> {
    if (next === 'approved') {
      return [
        paymentApprovedEvent(order, {
          paymentId: attempt.id,
          providerPaymentId: payment.providerPaymentId,
          amountArs: payment.amountArs,
        }),
      ]
    }
    if (next === 'rejected') {
      return [
        paymentRejectedEvent(order, { paymentId: attempt.id, statusDetail: payment.statusDetail }),
      ]
    }
    if (next === 'refunded') {
      return [
        paymentRefundedEvent(order, {
          paymentId: attempt.id,
          amountArs: payment.refundedArs > 0 ? payment.refundedArs : payment.amountArs,
          reason: await this.refundReasonOf(attempt.id),
        }),
      ]
    }
    return []
  }

  private async refundReasonOf(paymentId: string): Promise<RefundReason> {
    for (const reason of ['duplicate_payment', 'late_approval'] as const) {
      if ((await this.payments.findRefundByPayment(paymentId, reason)) !== null) return reason
    }
    return 'manual'
  }

  private async applyToOrder(
    order: OrderForPayment,
    attempt: PaymentAttempt,
    payment: ProviderPayment,
    now: Date,
  ): Promise<void> {
    if (attempt.status === 'approved') {
      await this.applyApproved(order, attempt, payment, now, false)
      return
    }
    if (order.status === 'pending_payment' || PAYING.includes(attempt.status)) return
    // Un intento que deja de cobrar en un pedido ya cerrado: si otro intento es el que pagó, el
    // pedido conserva el estado de ese pago (un duplicado devuelto no "devuelve" el pedido).
    const paying = await this.otherPaying(attempt)
    if (paying !== null) {
      await this.orders.setPaymentStatus(order.id, paying.status)
      return
    }
    if (attempt.status === 'refunded') await this.orders.markRefunded(order.id, now, () => [])
  }

  /**
   * Un aprobado que ya estaba guardado vuelve a llegar: si el pedido todavía necesita su efecto
   * (sigue `pending_payment` o es tardío), lo aplica de nuevo; si no, no hace nada.
   */
  private async resumeApproved(attempt: PaymentAttempt, payment: ProviderPayment): Promise<void> {
    const order = await this.orders.findForPaymentById(attempt.orderId)
    if (order === null) return
    if (order.status !== 'pending_payment' && !LATE_ORDER.includes(order.status)) return
    await this.applyApproved(order, attempt, payment, this.clock.now(), true)
  }

  private async applyApproved(
    order: OrderForPayment,
    attempt: PaymentAttempt,
    payment: ProviderPayment,
    now: Date,
    repeated: boolean,
  ): Promise<void> {
    let current: OrderForPayment | null = order
    if (current.status === 'pending_payment') {
      const approvedArs = (await this.payments.listByOrder(order.id))
        .filter((candidate) => candidate.status === 'approved')
        .reduce((sum, candidate) => sum + candidate.amountArs, 0)
      if (approvedArs < order.totalArs) {
        await this.orders.setPaymentStatus(order.id, 'pending')
        return
      }
      const paid = await this.orders.markPaid(order.id, now, (paidOrder) => [
        orderPaidEvent(paidOrder, now),
      ])
      if (paid !== null) return
      // Otro proceso lo cambió en el medio (otro pago lo pagó o venció): se decide con lo actual.
      current = await this.orders.findForPaymentById(order.id)
      if (current === null || current.status === 'pending_payment') return
    }
    if (LATE_ORDER.includes(current.status)) {
      await this.refund(attempt, payment, 'late_approval')
    } else if (!repeated && (await this.otherPaying(attempt)) !== null) {
      await this.refund(attempt, payment, 'duplicate_payment')
    }
  }

  private async otherPaying(attempt: PaymentAttempt): Promise<PaymentAttempt | null> {
    const attempts = await this.payments.listByOrder(attempt.orderId)
    return (
      attempts.find(
        (candidate) => candidate.id !== attempt.id && PAYING.includes(candidate.status),
      ) ?? null
    )
  }

  /**
   * Devuelve a Mercado Pago lo que queda de un pago aprobado: el total, o el saldo si ya se
   * devolvió una parte (lo usan la conciliación para un Checkout Pro dividido que nunca se
   * completó y el consumidor de `order.expired`). Idempotente por `(intento, motivo)`: si ya hay
   * una devolución con ese motivo, o no queda saldo, no hace nada. Un error de la pasarela deja la
   * fila `failed` y se avisa, no se relanza.
   *
   * @param attempt - Intento aprobado (o devuelto en parte) a devolver.
   * @param reason - Motivo de la devolución.
   * @throws {TypeError} En español, si el intento no tiene un pago en la pasarela.
   */
  async refundApproved(attempt: PaymentAttempt, reason: RefundReason): Promise<void> {
    if (attempt.providerPaymentId === null) {
      throw new TypeError(`El intento ${attempt.id} no tiene un pago en la pasarela para devolver`)
    }
    const balanceArs = attempt.amountArs - attempt.refundedArs
    if (balanceArs <= 0) return
    await this.refund(
      attempt,
      { providerPaymentId: attempt.providerPaymentId, amountArs: balanceArs },
      reason,
    )
  }

  private async refund(
    attempt: PaymentAttempt,
    payment: Pick<ProviderPayment, 'providerPaymentId' | 'amountArs'>,
    reason: RefundReason,
  ): Promise<void> {
    if ((await this.payments.findRefundByPayment(attempt.id, reason)) !== null) return
    const refund = await this.payments.createRefund({
      id: newId(),
      paymentId: attempt.id,
      amountArs: payment.amountArs,
      reason,
      idempotencyKey: newId(),
      createdAt: this.clock.now(),
    })
    try {
      const result = await this.gateway.refundPayment(
        payment.providerPaymentId,
        refund.idempotencyKey,
      )
      await this.payments.updateRefund(refund.id, {
        providerRefundId: result.providerRefundId,
        status: result.status,
      })
    } catch (error: unknown) {
      const message = errorMessage(error)
      await this.payments.updateRefund(refund.id, { status: 'failed', lastError: message })
      this.logger.warn(
        `No se pudo devolver el pago ${payment.providerPaymentId} (${reason}): ${message}. Devolvelo desde Mercado Pago.`,
      )
    }
  }
}
