/** Rol de un usuario: cliente de la tienda o administrador del dashboard. */
export type UserRole = 'customer' | 'admin'

/** Estado de un usuario: solo los `active` pueden iniciar sesión. */
export type UserStatus = 'active' | 'disabled'

/** Usuario con credenciales (cliente registrado o admin). */
export interface User {
  /** Id del usuario (UUID v7). */
  id: string
  /** Email normalizado (minúsculas, sin espacios alrededor); único. */
  email: string
  /** Hash de la contraseña (argon2id); nunca la contraseña en claro. */
  passwordHash: string
  /** Rol. */
  role: UserRole
  /** Estado. */
  status: UserStatus
  /** Cuándo verificó su email, o `null` (B3 no verifica emails). */
  emailVerifiedAt: Date | null
  /** Último inicio de sesión, o `null` si nunca entró. */
  lastLoginAt: Date | null
}
