/**
 * Fuente de secretos y hashes: tokens aleatorios criptográficamente seguros (ids de sesión, CSRF,
 * tokens de recuperación) y SHA-256 para guardar esos tokens sin dejarlos en claro.
 */
export interface SecretsPort {
  /**
   * Genera un token aleatorio.
   *
   * @param bytes - Cantidad de bytes aleatorios: entero entre 1 y 1024.
   * @returns Los bytes en hex en minúsculas (el doble de caracteres que `bytes`).
   */
  token(bytes: number): string

  /**
   * Calcula el SHA-256 de un texto (UTF-8).
   *
   * @param value - Texto a hashear.
   * @returns El hash en hex en minúsculas (64 caracteres).
   */
  sha256(value: string): string
}

/** Token de inyección del {@link SecretsPort}: `@Inject(SECRETS_PORT) secrets: SecretsPort`. */
export const SECRETS_PORT = Symbol('SECRETS_PORT')
