import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common'
import type { Observable } from 'rxjs'

import { isPublicRead } from '../throttler/public-read'

/** Valor de `Cache-Control` de las respuestas privadas. */
export const PRIVATE_CACHE_CONTROL = 'no-store'

/** La parte de la respuesta de Express que se usa para las cabeceras de caché. */
interface CacheHeadersResponse {
  setHeader(name: string, value: string): unknown
  /** `res.vary` de Express: suma el campo a `Vary` sin pisar los que ya tiene (CORS pone `Origin`). */
  vary(field: string): unknown
}

/**
 * Política de caché de la API (NV-11): toda respuesta que no sea una lectura pública
 * (`@PublicRead()`) sale con `Cache-Control: no-store` y `Vary: Cookie`, porque puede depender de
 * la sesión (cookie) o del `X-Order-Token`: `/me/*`, `/admin/*`, `/orders/{number}`, los pagos y
 * `GET /auth/csrf` (que además puede mandar `Set-Cookie`). Así un caché compartido (CDN o proxy) no
 * guarda ni sirve a otro los datos de una persona. Las lecturas públicas no cambian: la tienda las
 * cachea.
 *
 * Las cabeceras se ponen antes del handler, así también van en sus errores (por ejemplo el 404 de
 * un pedido ajeno). Los rechazos de los guards (401, 403, 429) salen antes y no las llevan: no
 * traen datos de nadie.
 */
@Injectable()
export class PrivateCacheInterceptor implements NestInterceptor {
  /** {@inheritDoc NestInterceptor.intercept} */
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() === 'http' && !isPublicRead(context)) {
      const res = context.switchToHttp().getResponse<CacheHeadersResponse>()
      res.setHeader('Cache-Control', PRIVATE_CACHE_CONTROL)
      res.vary('Cookie')
    }
    return next.handle()
  }
}
