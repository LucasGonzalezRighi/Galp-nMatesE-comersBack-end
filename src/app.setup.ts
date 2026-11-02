import type { INestApplication } from '@nestjs/common'
import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface'
import helmet from 'helmet'
import { Logger } from 'nestjs-pino'

import { ENV, type Env } from './config/env'
import { ProblemFilter } from './shared/infrastructure/http/problem.filter'
import { createValidationPipe } from './shared/infrastructure/http/validation.pipe'

/** Prefijo global de todas las rutas de la API, como en `servers` del contrato (`/api/v1`). */
export const API_PREFIX = 'api/v1'

/**
 * Opciones de CORS: solo el admin (`ADMIN_ORIGIN`; en desarrollo `http://localhost:5173`) puede
 * llamar a la API desde el navegador, con credenciales (las cookies de sesión). La tienda no
 * necesita CORS: lee desde su propio servidor. Un pedido de otro origen no recibe cabeceras CORS.
 *
 * @param env - La configuración validada; solo se usa `ADMIN_ORIGIN`.
 * @returns Las opciones para `app.enableCors`, con el origen normalizado (sin ruta ni barra final).
 */
export function buildCorsOptions(env: Pick<Env, 'ADMIN_ORIGIN'>): CorsOptions {
  return { origin: [new URL(env.ADMIN_ORIGIN).origin], credentials: true }
}

/**
 * Aplica la configuración que comparten `main.ts` y los E2E (`test/support/app.ts`), para no
 * duplicarla: logger pino para los logs de Nest, prefijo `/api/v1`, cabeceras de seguridad con
 * `helmet`, CORS solo para el admin (`buildCorsOptions`), errores `application/problem+json`
 * (`ProblemFilter`), validación global de DTOs (422 con `errors[]`) y hooks de apagado ordenado (cierran conexiones con `SIGTERM`/`SIGINT`).
 *
 * @param app - La app de Nest recién creada, antes de `init()` o `listen()`.
 */
export function setupApp(app: INestApplication): void {
  app.useLogger(app.get(Logger))
  app.setGlobalPrefix(API_PREFIX)
  app.use(helmet())
  app.enableCors(buildCorsOptions(app.get<Env>(ENV)))
  app.useGlobalFilters(new ProblemFilter())
  app.useGlobalPipes(createValidationPipe())
  app.enableShutdownHooks()
}
