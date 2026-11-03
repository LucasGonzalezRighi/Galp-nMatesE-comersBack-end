import type { PaymentStatus } from '../../orders/domain/order-status'

export type { InstallmentOption } from '../domain/installments'

/** `MercadoPagoPreference` del contrato. */
export interface PreferenceView {
  /** Dirección a la que la tienda redirige para pagar. */
  initPoint: string
}

/** `PaymentChallenge` del contrato. */
export interface PaymentChallengeView {
  /** Dirección del desafío 3-D Secure. */
  url: string
}

/** `CardPaymentResult` del contrato: el estado aplicado en este momento. */
export interface CardPaymentResultView {
  /** Estado del pago. */
  paymentStatus: PaymentStatus
  /** `status_detail` de Mercado Pago, o `null`. */
  statusDetail: string | null
  /** Desafío 3-D Secure pendiente, o `null`. */
  challenge: PaymentChallengeView | null
}
