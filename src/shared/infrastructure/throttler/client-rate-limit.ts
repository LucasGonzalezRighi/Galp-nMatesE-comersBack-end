import { applyDecorators, type ExecutionContext, SetMetadata } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { Throttle } from '@nestjs/throttler'

import { type ClientIpRequest, knownClientIp } from '../http/client-ip'

/** Un límite de `@nestjs/throttler`: `limit` pedidos cada `ttl` milisegundos. */
export interface ClientRateLimitOptions {
  /** Largo de la ventana en milisegundos. */
  readonly ttl: number
  /** Pedidos que entran en la ventana. */
  readonly limit: number
}

/** Metadata que marca una ruta limitada solo por la IP real del cliente. */
export const CLIENT_RATE_LIMIT_KEY = 'galpon:client-rate-limit'

const reflector = new Reflector()

/**
 * Limita una ruta (o un controlador) por la IP real del cliente, y solo cuando se conoce
 * ({@link skipWithoutKnownClientIp}): sin `TRUST_PROXY` todo llega con la IP del servidor de la
 * tienda y un límite por IP frenaría a toda la tienda; con `TRUST_PROXY`, los pedidos que origina
 * un proxy de confianza (el servidor de la tienda sin `X-Forwarded-For`) tampoco se cuentan. Lo
 * usan las lecturas públicas (`@PublicRead()`, NV-18) y las rutas de pago (NV-16). En el método
 * pisa el límite de la clase.
 *
 * @param rate - Pedidos por ventana para cada cliente (y para cada ruta).
 * @returns El decorador.
 */
export function ClientRateLimit(rate: ClientRateLimitOptions): ClassDecorator & MethodDecorator {
  return applyDecorators(
    SetMetadata(CLIENT_RATE_LIMIT_KEY, true),
    Throttle({ default: { ttl: rate.ttl, limit: rate.limit } }),
  )
}

/**
 * Indica si la ruta lleva {@link ClientRateLimit} (en el método o en la clase).
 *
 * @param context - Contexto de ejecución de Nest.
 * @returns `true` si la ruta se limita solo por la IP real del cliente.
 */
export function isClientRateLimited(context: ExecutionContext): boolean {
  return (
    reflector.getAllAndOverride<boolean | undefined>(CLIENT_RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]) === true
  )
}

/**
 * `skipIf` del límite por IP: una ruta con {@link ClientRateLimit} no se cuenta cuando no se
 * conoce la IP real del cliente ({@link knownClientIp}). Las demás rutas se cuentan siempre.
 *
 * @param context - Contexto de ejecución de Nest.
 * @returns `true` si el guard no tiene que contar este pedido.
 */
export function skipWithoutKnownClientIp(context: ExecutionContext): boolean {
  if (!isClientRateLimited(context)) return false
  return knownClientIp(context.switchToHttp().getRequest<ClientIpRequest>()) === null
}
