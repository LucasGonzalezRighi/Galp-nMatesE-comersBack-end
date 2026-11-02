import { Module } from '@nestjs/common'
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino'
import type { Options } from 'pino-http'

import { ConfigModule } from '../../../config/config.module'
import { ENV, type Env } from '../../../config/env'

/** Rutas que pino reemplaza por `[Redacted]`: cookies de sesión y tokens nunca llegan a los logs. */
const REDACTED_PATHS = [
  'req.headers.cookie',
  'req.headers.authorization',
  'res.headers["set-cookie"]',
]

/** Indica si un paquete opcional (como `pino-pretty`) se puede cargar. */
function isInstalled(packageName: string): boolean {
  try {
    require.resolve(packageName)
    return true
  } catch {
    return false
  }
}

/**
 * Arma las opciones de `pino-http` para el entorno: nivel `LOG_LEVEL` (en `test`, `silent`),
 * cookies y `Authorization` enmascarados, y salida legible con `pino-pretty` solo en desarrollo y
 * si está instalado (si no, JSON, como en producción).
 *
 * @param env - La configuración validada.
 * @returns Las opciones para `LoggerModule` de `nestjs-pino`.
 */
export function buildPinoHttpOptions(env: Env): Options {
  const options: Options = {
    level: env.NODE_ENV === 'test' ? 'silent' : env.LOG_LEVEL,
    redact: REDACTED_PATHS,
  }
  if (env.NODE_ENV === 'development' && isInstalled('pino-pretty')) {
    options.transport = { target: 'pino-pretty' }
  }
  return options
}

/**
 * Logger de la API con pino: un log por request (`pino-http`) y los logs de Nest, una vez que
 * `setupApp` hace `app.useLogger(app.get(Logger))`.
 */
@Module({
  imports: [
    PinoLoggerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ENV],
      useFactory: (env: Env) => ({ pinoHttp: buildPinoHttpOptions(env) }),
    }),
  ],
})
export class LoggerModule {}
