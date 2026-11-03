import type { PaymentAttempt } from '../domain/payment-attempt'
import type { PaymentGatewayPort } from './ports/payment-gateway.port'
import type { PaymentsLogger } from './ports/payments-logger.port'

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Cierra en Mercado Pago, con mejor esfuerzo, un intento que ya se canceló localmente: cancela el
 * pago pendiente (`PUT /v1/payments/{id}`) y vence la preferencia. Un error de la pasarela se
 * avisa y no se relanza (Ruling B-44).
 *
 * @param gateway - Pasarela.
 * @param attempt - Intento cancelado.
 * @param logger - Dónde avisar los errores.
 */
export async function releaseAtProvider(
  gateway: PaymentGatewayPort,
  attempt: PaymentAttempt,
  logger: PaymentsLogger,
): Promise<void> {
  if (attempt.providerPaymentId !== null) {
    try {
      await gateway.cancelPayment(attempt.providerPaymentId)
    } catch (error: unknown) {
      logger.warn(
        `No se pudo cancelar en Mercado Pago el pago ${attempt.providerPaymentId}: ${messageOf(error)}`,
      )
    }
  }
  if (attempt.providerPreferenceId !== null) {
    try {
      await gateway.expirePreference(attempt.providerPreferenceId)
    } catch (error: unknown) {
      logger.warn(
        `No se pudo vencer en Mercado Pago la preferencia ${attempt.providerPreferenceId}: ${messageOf(error)}`,
      )
    }
  }
}

/**
 * Texto de un error para guardar o avisar.
 *
 * @param error - Lo que se atrapó.
 * @returns El mensaje si es un `Error`; si no, el valor como texto.
 */
export function errorMessage(error: unknown): string {
  return messageOf(error)
}
