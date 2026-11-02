import { NestFactory } from '@nestjs/core'
import { existsSync } from 'node:fs'

import { AppModule } from './app.module'
import { setupApp } from './app.setup'
import { ENV, type Env } from './config/env'
import { setupSwagger } from './swagger'

/**
 * Carga `.env` en `process.env` si existe (desarrollo). Las variables que ya están en el entorno
 * tienen prioridad; los E2E no pasan por acá, así que no dependen de un `.env` local.
 */
function loadDotEnv(): void {
  if (existsSync('.env')) process.loadEnvFile('.env')
}

/**
 * Arranca la API con la misma configuración que los E2E (`setupApp`), monta Swagger UI en
 * `/api/docs` (salvo en producción) y escucha en `PORT`.
 *
 * Los logs quedan en buffer hasta que `setupApp` engancha pino. Si la configuración es inválida,
 * Nest no termina de crear la app y el error lista las variables a corregir.
 */
async function bootstrap(): Promise<void> {
  loadDotEnv()
  const app = await NestFactory.create(AppModule, { bufferLogs: true })
  setupApp(app)
  const env = app.get<Env>(ENV)
  setupSwagger(app, env)
  await app.listen(env.PORT)
}

void bootstrap()
