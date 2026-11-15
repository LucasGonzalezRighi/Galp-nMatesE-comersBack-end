import { applyDecorators, type ExecutionContext, SetMetadata } from '@nestjs/common'
import { Reflector } from '@nestjs/core'

import { ClientRateLimit } from './client-rate-limit'

/** Límite de las lecturas públicas (NV-18): 300 pedidos por minuto por IP real del cliente. */
export const PUBLIC_READ_RATE_LIMIT = { ttl: 60_000, limit: 300 } as const

/** Metadata que marca una lectura pública (`@PublicRead()`). */
export const PUBLIC_READ_KEY = 'galpon:public-read'

const reflector = new Reflector()

/**
 * Marca una lectura pública de la tienda (catálogo, contenido, reseñas y ajustes), en la clase o
 * en el método:
 *
 * - lleva el límite {@link PUBLIC_READ_RATE_LIMIT} por IP real del cliente, que solo se cuenta si
 *   se conoce esa IP ({@link ClientRateLimit}): el servidor de la tienda, que lee para armar sus
 *   páginas, nunca se limita;
 * - no lleva `Cache-Control: no-store` (la respuesta no depende de la sesión).
 *
 * @returns El decorador.
 */
export function PublicRead(): ClassDecorator & MethodDecorator {
  return applyDecorators(
    SetMetadata(PUBLIC_READ_KEY, true),
    ClientRateLimit(PUBLIC_READ_RATE_LIMIT),
  )
}

/**
 * Indica si la ruta es una lectura pública (`@PublicRead()` en el método o en la clase).
 *
 * @param context - Contexto de ejecución de Nest.
 * @returns `true` si la ruta está marcada.
 */
export function isPublicRead(context: ExecutionContext): boolean {
  return (
    reflector.getAllAndOverride<boolean | undefined>(PUBLIC_READ_KEY, [
      context.getHandler(),
      context.getClass(),
    ]) === true
  )
}
