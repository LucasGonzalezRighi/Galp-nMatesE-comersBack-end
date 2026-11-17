import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common'
import { PATH_METADATA } from '@nestjs/common/constants'
import { Reflector } from '@nestjs/core'
import { concatMap, type Observable } from 'rxjs'

import type { SessionRecord } from '../../../shared/application/ports/session.port'
import { type AdminWrite, AdminWriteAuditor } from '../application/admin-write-auditor'
import { resolveAdminWrite } from '../domain/admin-write'

/** Lo que el interceptor lee del pedido de Express. */
interface AuditedRequest {
  /** Método HTTP. */
  method: string
  /** Parámetros de la ruta. */
  params?: Record<string, unknown>
  /** Cuerpo ya parseado; `undefined` si el pedido no trae. */
  body?: unknown
  /** Sesión que dejó un guard de sesión o de CSRF (`SessionRequest`). */
  galponSession?: SessionRecord
}

/** Primera ruta de un `@Controller()` o de un `@Get()`/`@Post()`… (pueden declarar varias). */
function firstPath(metadata: unknown): string {
  const path: unknown = Array.isArray(metadata) ? metadata[0] : metadata
  return typeof path === 'string' ? path : ''
}

/**
 * Ruta de un handler como la declaran sus decoradores, sin el prefijo global de la API:
 * `@Controller('admin/categories')` + `@Patch(':id')` → `admin/categories/:id`.
 *
 * @param reflector - Lee la metadata de Nest.
 * @param controller - Clase del controlador.
 * @param handler - Método del controlador.
 * @returns La ruta con sus parámetros como `:nombre`, sin barras en las puntas.
 */
export function routePathOf(reflector: Reflector, controller: object, handler: object): string {
  // `Reflector.get` pide una clase o una función; el controlador y el handler lo son.
  const read = (target: object): unknown =>
    reflector.get<unknown>(PATH_METADATA, target as () => unknown)
  return [firstPath(read(controller)), firstPath(read(handler))]
    .flatMap((path) => path.split('/'))
    .filter((segment) => segment !== '')
    .join('/')
}

/**
 * Auditoría del dashboard (B8): cada escritura exitosa del admin deja una fila en `audit_logs`.
 * Es global y automática: actúa solo si el pedido trae la sesión de admin que dejan los guards,
 * el método es `POST`, `PUT`, `PATCH` o `DELETE` y la ruta está bajo `admin/`; una escritura nueva
 * del dashboard queda auditada sin tocar su controlador. La tabla de rutas y las exclusiones
 * (login, logout y la firma de fotos) están en `domain/admin-write.ts`.
 *
 * Lee la fila principal antes del handler y, cuando el handler responde bien, la vuelve a leer y
 * guarda la fila de auditoría antes de mandar la respuesta. Un handler que falla (4xx o 5xx) no
 * deja nada. Si la auditoría falla, la respuesta sale igual (`AdminWriteAuditor`).
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  /**
   * @param reflector - Lee la ruta del controlador y del handler.
   * @param auditor - Lee las filas y guarda la auditoría.
   */
  constructor(
    private readonly reflector: Reflector,
    private readonly auditor: AdminWriteAuditor,
  ) {}

  /**
   * @param context - Contexto de la ruta.
   * @param next - El handler.
   * @returns La respuesta del handler, sin cambios.
   */
  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const write = this.adminWriteOf(context)
    if (write === null) return next.handle()

    const pending = await this.auditor.begin(write)
    let recorded = false
    return next.handle().pipe(
      concatMap(async (body: unknown) => {
        if (!recorded) {
          recorded = true
          await this.auditor.complete(pending, body)
        }
        return body
      }),
    )
  }

  /** La escritura del dashboard de este pedido, o `null` si no hay nada que auditar. */
  private adminWriteOf(context: ExecutionContext): AdminWrite | null {
    if (context.getType() !== 'http') return null
    const req = context.switchToHttp().getRequest<AuditedRequest>()
    const session = req.galponSession
    if (session?.kind !== 'admin' || session.userId === null) return null
    const path = routePathOf(this.reflector, context.getClass(), context.getHandler())
    const target = resolveAdminWrite(req.method, path)
    if (target === null) return null
    return { target, actorUserId: session.userId, params: req.params ?? {}, body: req.body }
  }
}
