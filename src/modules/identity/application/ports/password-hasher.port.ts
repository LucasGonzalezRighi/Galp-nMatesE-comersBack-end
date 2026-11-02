/** Hash de contraseñas (argon2id en producción). */
export interface PasswordHasher {
  /**
   * Hashea una contraseña.
   *
   * @param plain - Contraseña en claro.
   * @returns El hash, con su sal y sus parámetros.
   */
  hash(plain: string): Promise<string>

  /**
   * Comprueba una contraseña contra un hash.
   *
   * @param hash - Hash guardado.
   * @param plain - Contraseña en claro.
   * @returns `true` si coincide; `false` si no coincide o el hash está malformado (nunca lanza
   *   por eso).
   */
  verify(hash: string, plain: string): Promise<boolean>
}

/** Token de inyección del {@link PasswordHasher}. */
export const PASSWORD_HASHER = Symbol('PASSWORD_HASHER')
