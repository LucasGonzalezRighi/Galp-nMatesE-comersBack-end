// Helpers HTTP de pagos: la clave idempotente que ya validó el interceptor y la notificación de
// Mercado Pago tal como llega. Son decoradores propios (no `@Headers()`/`@Query()`) para que
// Swagger documente solo lo que declara el contrato y el pipe global no toque el cuerpo.

import { createParamDecorator, type ExecutionContext } from '@nestjs/common'

import { IDEMPOTENCY_KEY_HEADER } from '../../../shared/infrastructure/idempotency/idempotency.interceptor'
import type { IncomingWebhook } from '../application/commands/receive-webhook.command'
import type { OrderAccess } from '../application/order-access'

/** Lo que leen los decoradores de este archivo de la petición de Express. */
interface PaymentsRequest {
  headers: Record<string, string | string[] | undefined>
  query: Record<string, unknown>
  body: unknown
}

/** La petición HTTP del contexto. */
function requestOf(context: ExecutionContext): PaymentsRequest {
  return context.switchToHttp().getRequest<PaymentsRequest>()
}

/**
 * Un valor de cabecera o de query como texto: `null` si no vino, vino vacío o repetido.
 *
 * @param value - Lo que trae Express.
 * @returns El texto, o `null`.
 */
export function singleValue(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

/**
 * Inyecta la `Idempotency-Key` en minúsculas (como la guarda el interceptor, que ya la validó
 * como UUID antes del handler); `''` si no vino, lo que el caso de uso rechaza.
 */
export const IdempotencyKeyHeader = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string =>
    (singleValue(requestOf(context).headers[IDEMPOTENCY_KEY_HEADER.toLowerCase()]) ?? '')
      .trim()
      .toLowerCase(),
)

/**
 * Inyecta la notificación de Mercado Pago para `ReceiveWebhookCommand`: `x-signature`,
 * `x-request-id`, las queries `data.id` y `topic` (formato IPN) y el cuerpo sin validar (el
 * formato de Mercado Pago puede traer más campos que el contrato).
 */
export const MercadoPagoNotification = createParamDecorator(
  (_data: unknown, context: ExecutionContext): IncomingWebhook => {
    const req = requestOf(context)
    return {
      signatureHeader: singleValue(req.headers['x-signature']),
      requestId: singleValue(req.headers['x-request-id']),
      dataIdQuery: singleValue(req.query['data.id']),
      topicQuery: singleValue(req.query.topic),
      body: req.body,
    }
  },
)

/**
 * Cómo llega la tienda a un pedido en las rutas de pago.
 *
 * @param number - Número ya validado por `OrderNumberParamDto`.
 * @param token - `X-Order-Token`, o `null`.
 * @returns El acceso para los casos de uso.
 */
export function orderAccess(number: string, token: string | null): OrderAccess {
  return { number, token }
}
