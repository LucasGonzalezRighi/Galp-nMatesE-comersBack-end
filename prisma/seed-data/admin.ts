// Escrito a mano (no lo genera scripts/import-fixtures.mjs): el admin semilla del panel.

/**
 * Credenciales del admin de demostración: las mismas del modo demo del front, para entrar al panel
 * en desarrollo. **Solo fuera de producción** (NV-10): en producción el seed exige credenciales
 * propias ({@link seedAdminCredentials}). El seed lo crea con la contraseña hasheada (argon2id) solo
 * si no existe: si después se cambió la contraseña desde el panel, una nueva corrida no la pisa.
 */
export const SEED_ADMIN = {
  email: 'admin@galponmates.com.ar',
  password: 'galpon-demo-2026',
} as const

/** Largo mínimo de una contraseña del admin que llega por `ADMIN_PASSWORD`. */
export const ADMIN_PASSWORD_MIN_LENGTH = 12

/** Email y contraseña con los que el seed crea el admin del panel. */
export interface SeedAdminCredentials {
  /** Email, recortado y en minúsculas. */
  readonly email: string
  /** Contraseña en claro (se guarda solo su hash). */
  readonly password: string
}

/** Entornos en los que corre el seed (los mismos que acepta la API). */
const NODE_ENVS: ReadonlySet<string> = new Set(['development', 'test', 'production'])

/** Forma mínima de un email: algo, una arroba y algo, sin espacios. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+$/

/** Mensaje cuando en producción falta alguna de las dos variables. */
const PRODUCTION_MISSING =
  'En producción el seed necesita ADMIN_EMAIL y ADMIN_PASSWORD (12 caracteres o más, distinta de la de demostración).'

/**
 * Decide con qué credenciales el seed crea el admin del panel (NV-10).
 *
 * - En `production` hacen falta `ADMIN_EMAIL` y `ADMIN_PASSWORD` propios: la contraseña con
 *   {@link ADMIN_PASSWORD_MIN_LENGTH} caracteres o más y distinta de la de demostración. Si falta
 *   algo, el seed no corre.
 * - En `development` y `test` valen las mismas variables si vienen (con el mismo largo mínimo); si
 *   no, las de demostración ({@link SEED_ADMIN}).
 * - Sin `NODE_ENV` (o con otro valor) no corre: un despliegue que se olvida de decirlo no termina
 *   con el admin de demostración.
 *
 * Los mensajes de error nunca muestran la contraseña.
 *
 * @param env - Las variables de entorno (en el seed, `process.env` ya con el `.env` cargado).
 * @returns El email (recortado y en minúsculas) y la contraseña.
 * @throws {Error} En español, si falta `NODE_ENV`, si en producción faltan las credenciales o si
 *   alguna no es válida.
 * @example
 * seedAdminCredentials({ NODE_ENV: 'development' }) // SEED_ADMIN
 */
export function seedAdminCredentials(
  env: Record<string, string | undefined>,
): SeedAdminCredentials {
  const nodeEnv = env.NODE_ENV
  if (nodeEnv === undefined || !NODE_ENVS.has(nodeEnv)) {
    throw new Error(
      'NODE_ENV tiene que ser development, test o production para correr el seed (definilo en el entorno o en .env).',
    )
  }
  const production = nodeEnv === 'production'
  const email = presentOrUndefined(env.ADMIN_EMAIL?.trim().toLowerCase())
  const password = presentOrUndefined(env.ADMIN_PASSWORD)

  if (production && (email === undefined || password === undefined)) {
    const missing = [
      email === undefined ? 'ADMIN_EMAIL' : null,
      password === undefined ? 'ADMIN_PASSWORD' : null,
    ].filter((name) => name !== null)
    throw new Error(`${PRODUCTION_MISSING} Falta: ${missing.join(' y ')}.`)
  }
  if (email !== undefined && !EMAIL_SHAPE.test(email)) {
    throw new Error('ADMIN_EMAIL tiene que ser un email (por ejemplo, admin@tu-dominio.com).')
  }
  if (password !== undefined && password.length < ADMIN_PASSWORD_MIN_LENGTH) {
    throw new Error(
      `ADMIN_PASSWORD tiene que tener ${String(ADMIN_PASSWORD_MIN_LENGTH)} caracteres o más.`,
    )
  }
  if (production && password === SEED_ADMIN.password) {
    throw new Error('En producción ADMIN_PASSWORD tiene que ser distinta de la de demostración.')
  }
  return { email: email ?? SEED_ADMIN.email, password: password ?? SEED_ADMIN.password }
}

/** El texto si tiene algo; `undefined` si falta o está vacío. */
function presentOrUndefined(value: string | undefined): string | undefined {
  return value === undefined || value === '' ? undefined : value
}
