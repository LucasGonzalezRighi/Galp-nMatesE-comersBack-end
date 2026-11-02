import type { INestApplication } from '@nestjs/common'
import helmet from 'helmet'

/** Prefijo global de todas las rutas de la API, como en `servers` del contrato (`/api/v1`). */
export const API_PREFIX = 'api/v1'

/**
 * Aplica la configuración que comparten `main.ts` y los E2E (`test/support/app.ts`), para no
 * duplicarla: prefijo `/api/v1`, cabeceras de seguridad con `helmet` y hooks de apagado
 * ordenado (cierran conexiones con `SIGTERM`/`SIGINT`).
 *
 * @param app - La app de Nest recién creada, antes de `init()` o `listen()`.
 */
export function setupApp(app: INestApplication): void {
  app.setGlobalPrefix(API_PREFIX)
  app.use(helmet())
  app.enableShutdownHooks()
}
