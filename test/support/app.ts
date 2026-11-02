import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import type { Server } from 'node:http'

import { AppModule } from '../../src/app.module'
import { setupApp } from '../../src/app.setup'

/**
 * Arma la app como `main.ts` (misma configuración, vía `setupApp`) sin escuchar ningún puerto:
 * los E2E le pegan con supertest a `app.getHttpServer()`.
 *
 * @returns La app ya inicializada; quien la crea la cierra con `app.close()`.
 */
export async function createApp(): Promise<INestApplication<Server>> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
  const app = moduleRef.createNestApplication<INestApplication<Server>>()
  setupApp(app)
  await app.init()
  return app
}
