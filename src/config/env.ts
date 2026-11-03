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
 * @throws {Error} En español, con una línea por variable que falta o es inválida (y una por cada
 *   regla entre variables que no se cumple, como `MP_MODE=live` sin sus credenciales). Nunca
 *   incluye el valor recibido, porque puede tener credenciales (por ejemplo la clave de
 *   `DATABASE_URL` o `MP_ACCESS_TOKEN`).
 */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source)
  if (result.success) return result.data

  const lines = new Set<string>()
  for (const issue of result.error.issues) {
    const key = issue.path[0]
    if (key === undefined) {
      // Regla entre variables (`superRefine` sin `path`): el mensaje ya dice qué corregir.
      lines.add(`- ${issue.message}`)
      continue
    }
    const name = String(key)
    const state = source[name] === undefined ? 'falta' : 'tiene un valor inválido'
    const hint = isEnvKey(name) ? `; se espera ${ENV_HINTS[name]}` : ''
    lines.add(`- ${name}: ${state}${hint}`)
  }
  throw new Error(
    `Variables de entorno inválidas (revisá el .env; la guía está en .env.example):\n${[...lines].join('\n')}`,
  )
}
