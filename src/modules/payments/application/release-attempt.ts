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
 * Qué clave idempotente le queda a un intento que la pasarela dejó cancelado sin cobrar (502, 422
 * de token o cuotas, error de red). La columna es única y el interceptor libera la clave de la
 * tienda cuando la ruta falla, así que el reintento (la tienda conserva la clave tras un 5xx) la
 * vuelve a usar: el intento caído tiene que soltarla. El resultado no es un UUID, así que nunca
 * choca con una clave nueva de la tienda, y conserva el origen para auditar.
 *
 * @param attempt - Intento cancelado por la falla de la pasarela.
 * @returns `<clave>:released:<id del intento>`.
 */
export function releasedIdempotencyKey(
  attempt: Pick<PaymentAttempt, 'id' | 'idempotencyKey'>,
): string {
  return `${attempt.idempotencyKey}:released:${attempt.id}`
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
