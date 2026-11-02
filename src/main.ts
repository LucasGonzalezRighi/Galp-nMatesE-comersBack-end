import { NestFactory } from '@nestjs/core'

import { AppModule } from './app.module'
import { setupApp } from './app.setup'

/** Puerto por defecto: la tienda y el admin esperan el back en `http://localhost:3001`. */
const DEFAULT_PORT = 3001

/**
 * Arranca la API con la misma configuración que los E2E (`setupApp`) y escucha en `PORT`.
 *
 * Los logs quedan en buffer hasta que se engancha el logger definitivo (pino, Task 2).
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true })
  setupApp(app)
  await app.listen(Number(process.env.PORT ?? DEFAULT_PORT))
}

void bootstrap()
