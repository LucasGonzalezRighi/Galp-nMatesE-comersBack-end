// Escrito a mano (no lo genera scripts/import-fixtures.mjs): el admin semilla del panel.

/**
 * Credenciales del admin semilla: las mismas del modo demo del front, para entrar al panel en
 * desarrollo. El seed lo crea con la contraseña hasheada (argon2id) solo si no existe: si después
 * se cambió la contraseña desde el panel, una nueva corrida no la pisa.
 */
export const SEED_ADMIN = {
  email: 'admin@galponmates.com.ar',
  password: 'galpon-demo-2026',
} as const
