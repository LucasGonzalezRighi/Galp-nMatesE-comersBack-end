import { z } from 'zod'

/** Configuración de la API, ya validada y con los valores por defecto aplicados. */
export interface Env {
  /** Entorno de ejecución (por defecto `development`): en `test` el logger no escribe nada. */
  NODE_ENV: 'development' | 'test' | 'production'
  /** Puerto HTTP (por defecto 3001, donde la tienda y el admin esperan el back). */
  PORT: number
  /** Conexión a Postgres: `postgresql://usuario:clave@host:5432/base`. */
  DATABASE_URL: string
  /** Conexión a Redis: `redis://host:6379` (o `rediss://` con TLS). */
  REDIS_URL: string
  /** Origen del admin, el único con CORS y credenciales (por defecto `http://localhost:5173`). */
  ADMIN_ORIGIN: string
  /** Origen de la tienda (por defecto `http://localhost:3000`). */
  STORE_ORIGIN: string
  /**
   * Secreto de `POST ${STORE_ORIGIN}/api/revalidate` (cabecera `x-revalidate-secret`): el mismo
   * `REVALIDATE_SECRET` de la tienda, de 32 caracteres o más. Obligatorio en `production`; sin él
   * no se le avisa nada a la tienda, que se regenera por tiempo. Nunca se loguea.
   */
  STORE_REVALIDATE_SECRET?: string | undefined
  /** Nivel mínimo de log (por defecto `info`). */
  LOG_LEVEL: 'debug' | 'info' | 'warn' | 'error'
  /**
   * Pasarela de pagos (por defecto `simulated`): `simulated` usa el simulador del back (sin
   * credenciales; no se admite en `production`) y `live` habla con Mercado Pago.
   */
  MP_MODE: 'simulated' | 'live'
  /** Access token de Mercado Pago (de prueba o productivo, hoy los dos `APP_USR-…`). Obligatorio con `live`; nunca se loguea. */
  MP_ACCESS_TOKEN?: string | undefined
  /** Clave secreta de las notificaciones (firma `x-signature`). Obligatoria con `live`. */
  MP_WEBHOOK_SECRET?: string | undefined
  /**
   * Origen público HTTPS de este back, sin ruta (`https://api.ejemplo.com`): arma la
   * `notification_url` del webhook. Obligatorio con `live`; en `simulated`, si falta, el simulador
   * usa `http://localhost:${PORT}`.
   */
  PUBLIC_API_ORIGIN?: string | undefined
  /** Texto del resumen de la tarjeta (por defecto `GALPON MATES`, hasta 13 caracteres). */
  MP_STATEMENT_DESCRIPTOR: string
}

const HTTP_PROTOCOL = /^https?$/

/** Mensaje de `parseEnv` cuando `MP_MODE=live` y falta alguna credencial. */
export const MP_LIVE_MISSING_MESSAGE =
  'Con MP_MODE=live hacen falta MP_ACCESS_TOKEN, MP_WEBHOOK_SECRET y PUBLIC_API_ORIGIN.'

/** Mensaje de `parseEnv` cuando `NODE_ENV=production` y `MP_MODE` no es `live`. */
export const MP_PRODUCTION_SIMULATED_MESSAGE = 'En producción MP_MODE tiene que ser live.'

/** Mensaje de `parseEnv` cuando `NODE_ENV=production` y falta `STORE_REVALIDATE_SECRET`. */
export const STORE_REVALIDATE_PRODUCTION_MESSAGE =
  'En producción hace falta STORE_REVALIDATE_SECRET (el mismo REVALIDATE_SECRET de la tienda).'

/** Indica si `value` es un origen sin ruta, query ni barra final (`https://host[:puerto]`). */
function isBareOrigin(value: string): boolean {
  return URL.canParse(value) && new URL(value).origin === value
}

/**
 * Esquema zod de las variables de entorno. Los nombres son los de `.env.example`; `PORT` llega
 * como texto y se convierte a número. Las reglas entre variables (`MP_MODE=live` exige sus tres
 * credenciales; `production` exige `live` y `STORE_REVALIDATE_SECRET`) se revisan solo si cada
 * variable es válida por sí sola.
 */
export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    REDIS_URL: z.url({ protocol: /^rediss?$/ }),
    ADMIN_ORIGIN: z.url({ protocol: HTTP_PROTOCOL }).default('http://localhost:5173'),
    STORE_ORIGIN: z.url({ protocol: HTTP_PROTOCOL }).default('http://localhost:3000'),
    STORE_REVALIDATE_SECRET: z.string().min(32).optional(),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    MP_MODE: z.enum(['simulated', 'live']).default('simulated'),
    MP_ACCESS_TOKEN: z.string().min(1).optional(),
    MP_WEBHOOK_SECRET: z.string().min(1).optional(),
    PUBLIC_API_ORIGIN: z.url({ protocol: HTTP_PROTOCOL }).refine(isBareOrigin).optional(),
    MP_STATEMENT_DESCRIPTOR: z.string().min(1).max(13).default('GALPON MATES'),
  })
  .superRefine((env, ctx) => {
    // Reglas entre variables: sin `path`, `parseEnv` muestra el mensaje tal cual.
    const live = env.MP_MODE === 'live'
    if (live && (!env.MP_ACCESS_TOKEN || !env.MP_WEBHOOK_SECRET || !env.PUBLIC_API_ORIGIN)) {
      ctx.addIssue({ code: 'custom', message: MP_LIVE_MISSING_MESSAGE, path: [] })
    }
    if (env.NODE_ENV === 'production' && !live) {
      ctx.addIssue({ code: 'custom', message: MP_PRODUCTION_SIMULATED_MESSAGE, path: [] })
    }
    if (env.NODE_ENV === 'production' && env.STORE_REVALIDATE_SECRET === undefined) {
      ctx.addIssue({ code: 'custom', message: STORE_REVALIDATE_PRODUCTION_MESSAGE, path: [] })
    }
  }) satisfies z.ZodType<Env>

/** Qué se espera en cada variable, para el mensaje de error de `parseEnv`. */
export const ENV_HINTS: Record<keyof Env, string> = {
  NODE_ENV: 'development, test o production',
  PORT: 'un número entero entre 1 y 65535',
  DATABASE_URL: 'una URL de Postgres (postgresql://usuario:clave@host:5432/base)',
  REDIS_URL: 'una URL de Redis (redis://host:6379)',
  ADMIN_ORIGIN: 'una URL http o https (por ejemplo http://localhost:5173)',
  STORE_ORIGIN: 'una URL http o https (por ejemplo http://localhost:3000)',
  STORE_REVALIDATE_SECRET: 'el mismo REVALIDATE_SECRET de la tienda, de 32 caracteres o más',
  LOG_LEVEL: 'debug, info, warn o error',
  MP_MODE: 'simulated o live',
  MP_ACCESS_TOKEN: 'el access token de Mercado Pago (no vacío)',
  MP_WEBHOOK_SECRET: 'la clave secreta de las notificaciones de Mercado Pago (no vacía)',
  PUBLIC_API_ORIGIN:
    'un origen http o https sin ruta ni barra final (por ejemplo https://api.ejemplo.com)',
  MP_STATEMENT_DESCRIPTOR: 'un texto de 1 a 13 caracteres (por ejemplo GALPON MATES)',
}
