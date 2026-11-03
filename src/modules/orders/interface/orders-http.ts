// Constantes y helpers HTTP de pedidos: los parámetros del contrato para Swagger (`OrderNumber` e
// `IdempotencyKey`), la lectura de `X-Order-Token` y el cliente de una sesión opcional.

import { createParamDecorator, type ExecutionContext } from '@nestjs/common'

import type { SessionRecord } from '../../../shared/application/ports/session.port'
import { customerIdOf } from '../../../shared/infrastructure/auth/session-ids'
import { schemaRef } from '../../../shared/infrastructure/http/openapi'
import { IDEMPOTENCY_KEY_HEADER } from '../../../shared/infrastructure/idempotency/idempotency.interceptor'

/** Cabecera con el token del pedido (en minúsculas, como la deja Node). */
export const ORDER_TOKEN_HEADER = 'x-order-token'

/** Parámetro `OrderNumber` del contrato, para `@ApiParam`. */
export const ORDER_NUMBER_PARAM = {
  name: 'number',
  description: 'Número del pedido, `GLP-` y cinco dígitos.',
  schema: schemaRef('OrderNumber'),
} as const

/** Parámetro `IdempotencyKey` del contrato, para `@ApiHeader`. */
export const IDEMPOTENCY_KEY_PARAM = {
  name: IDEMPOTENCY_KEY_HEADER,
  required: true,
  description:
    'UUID que genera el cliente para cada intento. Repetir la misma clave devuelve el resultado ' +
    'del primer intento; repetirla con otro cuerpo responde 422 `idempotency_key_reused`.',
  schema: { type: 'string', format: 'uuid' },
} as const

/** Pedido con las cabeceras que lee {@link OrderTokenHeader}. */
interface HeadersRequest {
  headers: Record<string, string | string[] | undefined>
}

/**
 * Valor de `X-Order-Token`, o `null` si no vino, vino vacío o repetido. No se declara como
 * `@Headers()` porque el contrato lo publica como esquema de seguridad (`orderToken`), no como
 * parámetro.
 *
 * @param context - Contexto de la petición.
 * @returns El token en claro, o `null`.
 */
export function orderTokenFromContext(context: ExecutionContext): string | null {
  const value = context.switchToHttp().getRequest<HeadersRequest>().headers[ORDER_TOKEN_HEADER]
  return typeof value === 'string' && value !== '' ? value : null
}

/** Inyecta el `X-Order-Token` de la petición (`string | null`). */
export const OrderTokenHeader = createParamDecorator((_data: unknown, context: ExecutionContext) =>
  orderTokenFromContext(context),
)

/**
 * Cliente de una sesión opcional (`@OptionalSession()`).
 *
 * @param session - Sesión de cliente, o `null` si no hay.
 * @returns El id del cliente, o `null` para un invitado.
 */
export function customerIdOrNull(session: SessionRecord | null): string | null {
  return session === null ? null : customerIdOf(session)
}
