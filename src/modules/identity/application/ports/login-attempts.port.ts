/**
 * Intentos fallidos de inicio de sesión por email: 10 fallos en una ventana de 15 minutos (que
 * arranca con el primero) bloquean el email por el resto de la ventana. **Falla abierta**: si el
 * almacén no responde, nada queda bloqueado y ninguna operación lanza.
 */
export interface LoginAttemptsPort {
  /**
   * Registra un fallo.
   *
   * @param email - Email normalizado (exista o no la cuenta).
   * @returns Los segundos de bloqueo que quedan si con este fallo el email está bloqueado, o
   *   `null` si no lo está (o el almacén no respondió).
   */
  fail(email: string): Promise<{ blockedForSeconds: number | null }>

  /**
   * Consulta el bloqueo antes de verificar la contraseña, para que durante el bloqueo ni la
   * contraseña correcta entre.
   *
   * @param email - Email normalizado.
   * @returns Los segundos de bloqueo que quedan, o `null` si no está bloqueado (o el almacén no
   *   respondió).
   */
  blockedFor(email: string): Promise<number | null>

  /**
   * Olvida los fallos de un email (después de un inicio de sesión correcto).
   *
   * @param email - Email normalizado.
   */
  clear(email: string): Promise<void>
}

/** Token de inyección del {@link LoginAttemptsPort}. */
export const LOGIN_ATTEMPTS_PORT = Symbol('LOGIN_ATTEMPTS_PORT')
