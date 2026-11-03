import type { PaymentMethod } from '../../orders/domain/order-status'
import type { PaymentAttempt } from '../domain/payment-attempt'
import { IdempotencyKeyReusedError } from '../domain/payments-errors'
import type { PaymentRepository } from './ports/payment.repository.port'

/**
 * El intento que ya tiene la `Idempotency-Key` de la tienda, para retomarlo en vez de crear otro.
 * Si la llegada anterior con esa clave falló después de crear el intento (por ejemplo, la base
 * cayó después de cobrar), el interceptor soltó la clave y la tienda reintenta con la misma: crear
 * otro intento cancelaría el que se cobró y chocaría con la columna única (500 en cada reintento).
 * Una clave soltada por una falla de la pasarela (`<clave>:released:<id>`) no aparece: ese
 * reintento crea un intento nuevo, como antes.
 *
 * @param payments - Intentos.
 * @param idempotencyKey - `Idempotency-Key` de la tienda.
 * @param orderId - Pedido que se quiere pagar.
 * @param method - Forma de pago de la ruta (`card` o `mp_redirect`).
 * @returns El intento con esa clave, o `null` si la clave es nueva.
 * @throws {IdempotencyKeyReusedError} 422 si la clave es de un intento de otro pedido o de otra
 *   forma de pago.
 */
export async function attemptToResume(
  payments: PaymentRepository,
  idempotencyKey: string,
  orderId: string,
  method: PaymentMethod,
): Promise<PaymentAttempt | null> {
  const attempt = await payments.findByIdempotencyKey(idempotencyKey)
  if (attempt === null) return null
  if (attempt.orderId !== orderId || attempt.method !== method) {
    throw new IdempotencyKeyReusedError()
  }
  return attempt
}
