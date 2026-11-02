import type { INestApplication } from '@nestjs/common'
import helmet from 'helmet'
import { Logger } from 'nestjs-pino'

import { ProblemFilter } from './shared/infrastructure/http/problem.filter'
import { createValidationPipe } from './shared/infrastructure/http/validation.pipe'

/** Prefijo global de todas las rutas de la API, como en `servers` del contrato (`/api/v1`). */
export const API_PREFIX = 'api/v1'

/**
 * Aplica la configuración que comparten `main.ts` y los E2E (`test/support/app.ts`), para no
 * duplicarla: logger pino para los logs de Nest, prefijo `/api/v1`, cabeceras de seguridad con
 * `helmet`, errores `application/problem+json` (`ProblemFilter`), validación global de DTOs
 * (422 con `errors[]`) y hooks de apagado ordenado (cierran conexiones con `SIGTERM`/`SIGINT`).
 *
 * @param app - La app de Nest recién creada, antes de `init()` o `listen()`.
 */
export function setupApp(app: INestApplication): void {
  app.useLogger(app.get(Logger))
  app.setGlobalPrefix(API_PREFIX)
  app.use(helmet())
  app.useGlobalFilters(new ProblemFilter())
  app.useGlobalPipes(createValidationPipe())
  app.enableShutdownHooks()
}
