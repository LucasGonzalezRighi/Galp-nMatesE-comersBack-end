import type { Clock } from '../../../../shared/domain/clock'
import type { OrderPaymentsPort } from '../../../orders/application/ports/order-payments.port'
import { IntentNotActiveError, PaymentAttemptNotFoundError } from '../../domain/payments-errors'
import type { ProviderPayment } from '../../domain/provider-payment'
import {
  newSimulatedPaymentId,
  simulatorOutcome,
  type SimulatorResult,
} from '../../domain/simulated-cards'
import type { PaymentRepository } from '../ports/payment.repository.port'
import type { ApplyProviderPaymentCommand } from './apply-provider-payment.command'

/** Lo que manda la página del simulador. */
export interface SimulatorResolution {
  /** Preferencia (página de checkout), o `null`. */
  preferenceId: string | null
  /** Pago (página del desafío 3-D Secure), o `null`. */
  providerPaymentId: string | null
  /** Botón elegido. */
  result: SimulatorResult
}

/**
 * Simulador del back (Ruling B-55): aplica el resultado elegido en sus páginas como si fuera la
 * notificación de Mercado Pago. Solo para el intento activo de un pedido `pending_payment`.
 */
export class SimulateProviderResultCommand {
  /**
   * @param payments - Intentos.
   * @param orders - Pedidos para pagos.
   * @param apply - Máquina de estados.
   * @param clock - Reloj.
   * @param remember - Guarda el pago en el `SimulatedGateway` para que `getPayment` lo devuelva.
   */
  constructor(
    private readonly payments: PaymentRepository,
    private readonly orders: OrderPaymentsPort,
    private readonly apply: Pick<ApplyProviderPaymentCommand, 'execute'>,
    private readonly clock: Clock,
    private readonly remember: (payment: ProviderPayment) => void = () => undefined,
  ) {}

  /**
   * @param input - Preferencia o pago, y el resultado.
   * @returns El número del pedido (para volver a la tienda).
   * @throws {TypeError} En español, si no viene ni preferencia ni pago.
   * @throws {PaymentAttemptNotFoundError} 404 si no hay un intento con esa preferencia o ese pago.
   * @throws {IntentNotActiveError} 409 si el intento ya no está activo o el pedido ya no espera el pago.
   */
  async execute(input: SimulatorResolution): Promise<{ number: string }> {
    const attempt =
      input.providerPaymentId !== null
        ? await this.payments.findByProviderPaymentId('mercadopago', input.providerPaymentId)
        : input.preferenceId !== null
          ? await this.payments.findByPreferenceId('mercadopago', input.preferenceId)
          : undefined
    if (attempt === undefined) {
      throw new TypeError('El simulador necesita una preferencia o un pago')
    }
    if (attempt === null) throw new PaymentAttemptNotFoundError()
    const order = await this.orders.findForPaymentById(attempt.orderId)
    if (order === null) throw new PaymentAttemptNotFoundError()
    if (!attempt.isActive || order.status !== 'pending_payment') throw new IntentNotActiveError()
    const outcome = simulatorOutcome(input.result)
    const payment: ProviderPayment = {
      providerPaymentId: attempt.providerPaymentId ?? newSimulatedPaymentId(),
      status: outcome.status,
      statusDetail: outcome.statusDetail,
      amountArs: order.totalArs,
      refundedArs: 0,
      installments: attempt.installments,
      paymentTypeId: attempt.paymentTypeId,
      paymentMethodId: attempt.cardBrand,
      cardLastFour: attempt.cardLastFour,
      issuerId: attempt.issuerId,
      externalReference: order.number,
      challengeUrl: null,
      approvedAt: outcome.status === 'approved' ? this.clock.now() : null,
    }
    this.remember(payment)
    await this.apply.execute(payment, { attemptId: attempt.id, source: 'simulator' })
    return { number: order.number }
  }
}
