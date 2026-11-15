import type { NestApplicationOptions } from '@nestjs/common'
import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface'
import type { NestExpressApplication } from '@nestjs/platform-express'
import cookieParser from 'cookie-parser'
import helmet from 'helmet'
import { Logger } from 'nestjs-pino'

import { ENV, type Env } from './config/env'
import { isSimulatorEnabled } from './modules/payments/interface/simulated-mercadopago.controller'
import { applyTrustProxy } from './shared/infrastructure/http/client-ip'
import { ProblemFilter } from './shared/infrastructure/http/problem.filter'
import { createValidationPipe } from './shared/infrastructure/http/validation.pipe'

/** Prefijo global de todas las rutas de la API, como en `servers` del contrato (`/api/v1`). */
export const API_PREFIX = 'api/v1'

/**
 * Opciones de CORS: solo el admin (`ADMIN_ORIGIN`; en desarrollo `http://localhost:5173`) puede
 * llamar a la API desde el navegador, con credenciales (las cookies de sesión). La tienda no
 * necesita CORS: lee desde su propio servidor. Un pedido de otro origen no recibe cabeceras CORS.
 * `Retry-After` va expuesta, para que el admin pueda leer la espera de un 429 desde su origen.
 *
 * @param env - La configuración validada; solo se usa `ADMIN_ORIGIN`.
 * @returns Las opciones para `app.enableCors`, con el origen normalizado (sin ruta ni barra final).
 */
export function buildCorsOptions(env: Pick<Env, 'ADMIN_ORIGIN'>): CorsOptions {
  return {
    origin: [new URL(env.ADMIN_ORIGIN).origin],
    credentials: true,
    exposedHeaders: ['Retry-After'],
  }
}

/**
 * Opciones con las que se crea la app en `main.ts` y en los E2E: sin los body parsers por defecto
 * de Nest (JSON y formularios anidados, con cuerpos comprimidos, en todas las rutas; NV-17). Los
 * registra `setupApp`, acotados ({@link setupBodyParsers}).
 */
export const APP_OPTIONS = { bodyParser: false } as const satisfies NestApplicationOptions

/** Tope del cuerpo JSON (NV-17). */
export const JSON_BODY_LIMIT = '100kb'

/** Tope del cuerpo de un formulario del simulador de pagos (3 campos cortos). */
export const FORM_BODY_LIMIT = '8kb'

/** Máximo de campos de un formulario del simulador de pagos. */
export const FORM_PARAMETER_LIMIT = 10

/**
 * Registra los body parsers (NV-17): JSON de hasta {@link JSON_BODY_LIMIT}, sin cuerpos
 * comprimidos (`Content-Encoding` distinto de `identity` responde 415). Los formularios
 * (`application/x-www-form-urlencoded`) solo se aceptan con el simulador de pagos prendido (nunca
 * en producción), que los usa en sus páginas: planos (sin `a[b]=c` anidados), sin comprimir y
 * chicos. En el resto de los casos un formulario llega sin cuerpo y la validación responde 422.
 *
 * @param app - La app de Nest con Express, creada con {@link APP_OPTIONS}.
 * @param env - La configuración; decide si el simulador está prendido.
 */
export function setupBodyParsers(
  app: Pick<NestExpressApplication, 'useBodyParser'>,
  env: Pick<Env, 'MP_MODE' | 'NODE_ENV'>,
): void {
  app.useBodyParser('json', { limit: JSON_BODY_LIMIT, inflate: false })
  if (isSimulatorEnabled(env)) {
    app.useBodyParser('urlencoded', {
      extended: false,
      inflate: false,
      limit: FORM_BODY_LIMIT,
      parameterLimit: FORM_PARAMETER_LIMIT,
    })
  }
}

/**
 * Aplica la configuración que comparten `main.ts` y los E2E (`test/support/app.ts`), para no
 * duplicarla: logger pino para los logs de Nest, prefijo `/api/v1`, `trust proxy` según
 * `TRUST_PROXY` (NV-25: los límites por IP cuentan la IP real del cliente), body parsers acotados
 * ({@link setupBodyParsers}), cookies parseadas en `req.cookies` (`cookie-parser`, para los guards
 * de sesión), cabeceras de seguridad con `helmet`, CORS solo para el admin (`buildCorsOptions`),
 * errores `application/problem+json` (`ProblemFilter`), validación global de DTOs (422 con
 * `errors[]`) y hooks de apagado ordenado (cierran conexiones con `SIGTERM`/`SIGINT`).
 *
 * @param app - La app de Nest recién creada con {@link APP_OPTIONS}, antes de `init()` o
 *   `listen()`.
 */
export function setupApp(app: NestExpressApplication): void {
  const env = app.get<Env>(ENV)
  app.useLogger(app.get(Logger))
  app.setGlobalPrefix(API_PREFIX)
  applyTrustProxy(app, env.TRUST_PROXY)
  setupBodyParsers(app, env)
  app.use(cookieParser())
  app.use(helmet())
  app.enableCors(buildCorsOptions(env))
  app.useGlobalFilters(new ProblemFilter())
  app.useGlobalPipes(createValidationPipe())
  app.enableShutdownHooks()
}
