import type { Clock } from '../../../../shared/domain/clock'
import type {
  OrderForPayment,
  OrderPaymentsPort,
} from '../../../orders/application/ports/order-payments.port'
import { isActiveStatus, type PaymentAttempt } from '../../domain/payment-attempt'
import type { ProviderPayment } from '../../domain/provider-payment'
import type { OrderExpirer } from '../order-access'
import type { PaymentGatewayPort } from '../ports/payment-gateway.port'
import type { PaymentRepository } from '../ports/payment.repository.port'
import { SILENT_PAYMENTS_LOGGER, type PaymentsLogger } from '../ports/payments-logger.port'
import { errorMessage } from '../release-attempt'
import type { ApplyProviderPaymentCommand } from './apply-provider-payment.command'

/** Pedidos por pasada del barrido. */
export const RECONCILE_BATCH_SIZE = 50

/** Cuánto después de vencida la reserva se consulta un pago en curso. */
export const RECONCILE_AFTER_MS = 10 * 60_000

/** Cuánto después de vencida la reserva se abandona un pago que sigue pendiente. */
export const ABANDON_AFTER_MS = 48 * 60 * 60_000

/** Resultado de una pasada. */
export interface ReconcileResult {
  /** Pedidos consultados en la pasarela sin error. */
  reconciled: number
  /** Pedidos que vencieron en la pasada. */
  expired: number
  /** Pedidos que fallaron (se avisan y siguen los demás). */
  failed: number
}

/** Un pago en curso con id en la pasarela. */
type InFlightAttempt = PaymentAttempt & { providerPaymentId: string }

function isInFlight(attempt: PaymentAttempt): attempt is InFlightAttempt {
  return (
    (attempt.status === 'pending' || attempt.status === 'action_required') &&
    attempt.providerPaymentId !== null
  )
}

/**
 * Conciliación de pagos en curso (Ruling B-42; corre en el barrido de 60 s después de
 * `expireDue`): para cada pedido `pending_payment` con pago `pending`/`action_required` y la
 * reserva vencida hace 10 minutos o más, consulta el pago y lo aplica; si a las 48 h sigue
 * pendiente, lo cancela en Mercado Pago y aplica `cancelled`. Después intenta vencer el pedido
 * (vence solo si el pago quedó vencible).
 *
 * Un Checkout Pro dividido que quedó con aprobados por menos del total no tiene pago en curso que
 * consultar: a las 48 h se devuelven esos aprobados (motivo `late_approval`: el pedido no se
 * completó a tiempo), el pedido queda con `payment_status = cancelled` y vence en la misma pasada.
 * Si la devolución falla, la fila queda `failed` y B6 la muestra como "Devolvelo desde Mercado
 * Pago".
 */
export class ReconcilePendingPaymentsCommand {
  /**
   * @param orders - Pedidos esperando el pago.
   * @param payments - Intentos.
   * @param gateway - Pasarela.
   * @param apply - Máquina de estados (aplicar un pago y devolver un aprobado).
   * @param expire - Vencimiento de un pedido (`ExpireOrdersCommand`).
   * @param clock - Reloj.
   * @param logger - Avisos de los pedidos que fallan.
   */
  constructor(
    private readonly orders: OrderPaymentsPort,
    private readonly payments: PaymentRepository,
    private readonly gateway: PaymentGatewayPort,
    private readonly apply: Pick<ApplyProviderPaymentCommand, 'execute' | 'refundApproved'>,
    private readonly expire: OrderExpirer,
    private readonly clock: Clock,
    private readonly logger: PaymentsLogger = SILENT_PAYMENTS_LOGGER,
  ) {}

  /**
   * @param limit - Máximo de pedidos por pasada.
   * @returns Cuántos se consultaron, vencieron y fallaron.
   * @throws {RangeError} En español, si el límite no es un entero positivo.
   */
  async execute(limit: number = RECONCILE_BATCH_SIZE): Promise<ReconcileResult> {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new RangeError(
        `El máximo de pedidos a conciliar tiene que ser un entero positivo (llegó ${String(limit)})`,
      )
    }
    const now = this.clock.now()
    const due = await this.orders.listAwaitingPayment(
      new Date(now.getTime() - RECONCILE_AFTER_MS),
      limit,
    )
    const result: ReconcileResult = { reconciled: 0, expired: 0, failed: 0 }
    for (const order of due) {
      try {
        await this.reconcile(order, now)
        result.reconciled += 1
        if ((await this.expire.expireOne(order.id)) !== null) result.expired += 1
      } catch (error: unknown) {
        result.failed += 1
        this.logger.warn(
          `No se pudo conciliar el pago del pedido ${order.number}: ${errorMessage(error)}`,
        )
      }
    }
    return result
  }

  private async reconcile(order: OrderForPayment, now: Date): Promise<void> {
    const abandoned = order.reservedUntil.getTime() + ABANDON_AFTER_MS < now.getTime()
    const attempts = (await this.payments.listByOrder(order.id)).filter(isInFlight)
    for (const attempt of attempts) {
      const context = { attemptId: attempt.id, source: 'reconcile' } as const
      const current = await this.gateway.getPayment(attempt.providerPaymentId)
      const applied = current === null ? attempt : await this.apply.execute(current, context)
      if (!abandoned || !isActiveStatus((applied ?? attempt).status)) continue
      const cancelled = await this.gateway.cancelPayment(attempt.providerPaymentId)
      await this.apply.execute(
        cancelled ?? {
          ...(current ?? this.asProviderPayment(attempt, order)),
          status: 'cancelled',
          statusDetail: 'by_collector',
        },
        context,
      )
    }
    if (abandoned) await this.closeUnfinished(order)
  }

  /**
   * A las 48 h, un pedido que sigue `pending_payment` con aprobados por menos del total y sin
   * pagos en curso nunca se va a completar: se devuelven los aprobados y el pedido queda vencible.
   */
  private async closeUnfinished(order: OrderForPayment): Promise<void> {
    const current = await this.orders.findForPaymentById(order.id)
    if (current?.status !== 'pending_payment') return
    const attempts = await this.payments.listByOrder(order.id)
    const approved = attempts.filter((attempt) => attempt.status === 'approved')
    const approvedArs = approved.reduce((sum, attempt) => sum + attempt.amountArs, 0)
    if (approved.length === 0 || approvedArs >= current.totalArs || attempts.some(isInFlight)) {
      return
    }
    for (const attempt of approved) await this.apply.refundApproved(attempt, 'late_approval')
    await this.orders.setPaymentStatus(order.id, 'cancelled')
  }

  private asProviderPayment(attempt: InFlightAttempt, order: OrderForPayment): ProviderPayment {
    return {
      providerPaymentId: attempt.providerPaymentId,
      status: attempt.providerStatus ?? 'pending',
      statusDetail: attempt.statusDetail,
      amountArs: attempt.amountArs,
      refundedArs: attempt.refundedArs,
      installments: attempt.installments,
      paymentTypeId: attempt.paymentTypeId,
      paymentMethodId: attempt.cardBrand,
      cardLastFour: attempt.cardLastFour,
      issuerId: attempt.issuerId,
      externalReference: order.number,
      challengeUrl: attempt.challengeUrl,
      approvedAt: attempt.approvedAt,
    }
  }
}
