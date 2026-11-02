import { ENV_HINTS, envSchema, type Env } from './env.schema'

export type { Env } from './env.schema'

/** Token de inyección de la configuración validada: `@Inject(ENV) private readonly env: Env`. */
export const ENV = Symbol('ENV')

/** Indica si `key` es una de las variables que conoce el esquema. */
function isEnvKey(key: string): key is keyof Env {
  return Object.hasOwn(ENV_HINTS, key)
}

/**
 * Valida las variables de entorno y aplica los valores por defecto.
 *
 * @param source - Las variables crudas; en la app, `process.env`.
 * @returns La configuración tipada.
 * @throws {Error} En español, con una línea por variable que falta o es inválida. Nunca incluye el
 *   valor recibido, porque puede tener credenciales (por ejemplo la clave de `DATABASE_URL`).
 */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source)
  if (result.success) return result.data

  const keys = new Set(result.error.issues.map((issue) => String(issue.path[0])))
  const lines = [...keys].map((key) => {
    const state = source[key] === undefined ? 'falta' : 'tiene un valor inválido'
    const hint = isEnvKey(key) ? `; se espera ${ENV_HINTS[key]}` : ''
    return `- ${key}: ${state}${hint}`
  })
  throw new Error(
    `Variables de entorno inválidas (revisá el .env; la guía está en .env.example):\n${lines.join('\n')}`,
  )
}
