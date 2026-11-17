import { Module } from '@nestjs/common'
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino'
import type { Options } from 'pino-http'

import { ConfigModule } from '../../../config/config.module'
import { ENV, type Env } from '../../../config/env'

/**
 * Rutas que pino reemplaza por `[Redacted]`: cookies de sesión y tokens nunca llegan a los logs.
 * `Referer` se tapa entero porque, desde `/cuenta/restablecer?token=…`, la tienda reenvía al back
 * la URL con el token de recuperación; `X-CSRF-Token` es el secreto ligado a la sesión,
 * `X-Order-Token` abre un pedido sin sesión e `Idempotency-Key` también: la repetición idempotente
 * devuelve la respuesta guardada antes de mirar el token, así que con la clave y la URL del log se
 * leía la preferencia de pago de otro (auditoría NV-01).
 */
const REDACTED_PATHS = [
  'req.headers.cookie',
  'req.headers.authorization',
  'req.headers.referer',
  'req.headers["x-csrf-token"]',
  'req.headers["x-order-token"]',
  'req.headers["idempotency-key"]',
  'res.headers["set-cookie"]',
]

/** Pedido HTTP como lo deja el serializador estándar de pino (`pino-std-serializers`). */
export interface SerializedRequest {
  /** Id del pedido. */
  id?: unknown
  /** Método HTTP. */
  method?: string
  /** URL con la query (Express usa `originalUrl`). */
  url?: string
  /** Query ya interpretada por Express. */
  query?: unknown
  /** Parámetros de la ruta. */
  params?: unknown
  /** Cabeceras (las sensibles las tapa `redact`). */
  headers?: unknown
  /** IP de quien pide (se conserva por seguridad, LS-5). */
  remoteAddress?: string
  /** Puerto de quien pide. */
  remotePort?: number
}

/** Pedido HTTP como queda en el log: la ruta sin query y solo los nombres de sus parámetros. */
export interface LoggedRequest {
  /** Id del pedido. */
  id?: unknown
  /** Método HTTP. */
  method?: string
  /** La ruta, sin la query. */
  url?: string
  /** Los nombres de los parámetros de la query, sin repetir y sin sus valores. */
  query: string[]
  /** Cabeceras (las sensibles las tapa `redact`). */
  headers?: unknown
  /** IP de quien pide. */
  remoteAddress?: string
  /** Puerto de quien pide. */
  remotePort?: number
}

/**
 * Serializador del pedido en el log de cada request (LS-5): la ruta queda sin los valores de la
 * query (la búsqueda `q` del admin puede ser un email o un nombre) y de la query solo los nombres.
 * Tampoco van los parámetros de la ruta: ya están en la ruta.
 *
 * @param req - El pedido ya serializado por pino.
 * @returns El pedido para el log.
 */
export function serializeRequest(req: SerializedRequest): LoggedRequest {
  const url = req.url ?? ''
  const mark = url.indexOf('?')
  const names = mark === -1 ? [] : [...new Set(new URLSearchParams(url.slice(mark + 1)).keys())]
  const logged: LoggedRequest = { query: names }
  if (req.id !== undefined) logged.id = req.id
  if (req.method !== undefined) logged.method = req.method
  if (req.url !== undefined) logged.url = mark === -1 ? url : url.slice(0, mark)
  if (req.headers !== undefined) logged.headers = req.headers
  if (req.remoteAddress !== undefined) logged.remoteAddress = req.remoteAddress
  if (req.remotePort !== undefined) logged.remotePort = req.remotePort
  return logged
}

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
 * cookies, `Authorization`, `Referer`, `X-CSRF-Token`, `X-Order-Token` e `Idempotency-Key`
 * enmascarados, la ruta sin los valores de la query ({@link serializeRequest}), y salida legible con
 * `pino-pretty` solo en desarrollo y si está instalado (si no, JSON, como en producción).
 *
 * @param env - La configuración validada.
 * @returns Las opciones para `LoggerModule` de `nestjs-pino`.
 */
export function buildPinoHttpOptions(env: Env): Options {
  const options: Options = {
    level: env.NODE_ENV === 'test' ? 'silent' : env.LOG_LEVEL,
    redact: REDACTED_PATHS,
    serializers: { req: serializeRequest },
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
