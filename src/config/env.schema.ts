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
  /** Nivel mínimo de log (por defecto `info`). */
  LOG_LEVEL: 'debug' | 'info' | 'warn' | 'error'
}

const HTTP_PROTOCOL = /^https?$/

/**
 * Esquema zod de las variables de entorno. Los nombres son los de `.env.example`; `PORT` llega
 * como texto y se convierte a número.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  REDIS_URL: z.url({ protocol: /^rediss?$/ }),
  ADMIN_ORIGIN: z.url({ protocol: HTTP_PROTOCOL }).default('http://localhost:5173'),
  STORE_ORIGIN: z.url({ protocol: HTTP_PROTOCOL }).default('http://localhost:3000'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
}) satisfies z.ZodType<Env>

/** Qué se espera en cada variable, para el mensaje de error de `parseEnv`. */
export const ENV_HINTS: Record<keyof Env, string> = {
  NODE_ENV: 'development, test o production',
  PORT: 'un número entero entre 1 y 65535',
  DATABASE_URL: 'una URL de Postgres (postgresql://usuario:clave@host:5432/base)',
  REDIS_URL: 'una URL de Redis (redis://host:6379)',
  ADMIN_ORIGIN: 'una URL http o https (por ejemplo http://localhost:5173)',
  STORE_ORIGIN: 'una URL http o https (por ejemplo http://localhost:3000)',
  LOG_LEVEL: 'debug, info, warn o error',
}
