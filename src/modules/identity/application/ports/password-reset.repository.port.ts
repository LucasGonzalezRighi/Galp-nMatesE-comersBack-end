/** Token de recuperación nuevo: solo su hash, nunca el token en claro. */
export interface NewPasswordResetToken {
  /** Usuario que pidió el cambio. */
  userId: string
  /** SHA-256 en hex del token. */
  tokenHash: string
  /** Cuándo vence. */
  expiresAt: Date
}

/** Tokens de recuperación de contraseña (la tabla `password_reset_tokens`). */
export interface PasswordResetRepository {
  /**
   * Guarda un token nuevo.
   *
   * @param input - Usuario, hash del token y vencimiento.
   */
  create(input: NewPasswordResetToken): Promise<void>

  /**
   * Usa un token: marca `used_at` de forma atómica (dos usos simultáneos no pasan los dos).
   *
   * @param tokenHash - SHA-256 en hex del token recibido.
   * @param now - Hora actual, para el vencimiento y para `used_at`.
   * @returns El usuario del token, o `null` si no existe, venció o ya se usó.
   */
  consume(tokenHash: string, now: Date): Promise<{ userId: string } | null>
}

/** Token de inyección del {@link PasswordResetRepository}. */
export const PASSWORD_RESET_REPOSITORY = Symbol('PASSWORD_RESET_REPOSITORY')
