import type { InstallmentOption } from '../../domain/installments'
import type { OrderAccess, PaymentOrderAccess } from '../order-access'
import type { PaymentGatewayPort } from '../ports/payment-gateway.port'
import type { PaymentsSettings } from '../ports/payments-settings.port'

/** BIN: los primeros 6 a 8 dígitos de la tarjeta. */
const BIN_PATTERN = /^\d{6,8}$/

/** Tipos de tarjeta que acepta la consulta. */
const CARD_PAYMENT_TYPES: readonly string[] = ['credit_card', 'debit_card']

/**
 * `POST /orders/{number}/payments/mercadopago/installments`: las cuotas de la pasarela para la
 * tarjeta, siempre sobre `order.totalArs` (nunca un monto del front). No cambia nada.
 */
export class GetInstallmentsQuery {
  /**
   * @param access - Lectura del pedido con token.
   * @param gateway - Pasarela.
   * @param settings - Máximo sin interés de los ajustes.
   */
  constructor(
    private readonly access: PaymentOrderAccess,
    private readonly gateway: PaymentGatewayPort,
    private readonly settings: PaymentsSettings,
  ) {}

  /**
   * @param access - Número y `X-Order-Token`.
   * @param input - BIN y tipo de tarjeta.
   * @returns Las opciones, de menos a más cuotas (débito: solo 1 pago).
   * @throws {TypeError} En español, si el BIN o el tipo no son válidos.
   * @throws {OrderNotFoundError} 404 sin token, con token ajeno o sin pedido.
   * @throws {OrderNotPayableError} 409 si el pedido no está `pending_payment`.
   */
  async execute(
    access: OrderAccess,
    input: { bin: string; paymentTypeId: 'credit_card' | 'debit_card' },
  ): Promise<InstallmentOption[]> {
    if (!BIN_PATTERN.test(input.bin)) {
      throw new TypeError('El BIN tiene que tener de 6 a 8 dígitos')
    }
    if (!CARD_PAYMENT_TYPES.includes(input.paymentTypeId)) {
      throw new TypeError('El tipo de tarjeta tiene que ser credit_card o debit_card')
    }
    const order = await this.access.payable(access)
    return this.gateway.getInstallments({
      bin: input.bin,
      paymentTypeId: input.paymentTypeId,
      amountArs: order.totalArs,
      maxWithoutInterest: await this.settings.maxWithoutInterest(),
    })
  }
}
