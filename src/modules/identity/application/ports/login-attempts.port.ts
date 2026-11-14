/** A quién se le cuentan los intentos: el email y la IP del cliente, juntos. */
export interface LoginAttemptKey {
  /** Email normalizado (exista o no la cuenta). */
  email: string
  /** IP del cliente que intenta entrar. */
  clientIp: string
}

/** Lo que dice el contador sobre un intento, antes de verificar la contraseña. */
export interface LoginAttempt {
  /**
   * Segundos de bloqueo que quedan si el par ya pasó el tope: el intento no se verifica. `null` si
   * se puede verificar.
   */
  blockedForSeconds: number | null
  /**
   * Segundos de bloqueo que arrancan si este intento falla (es el último permitido de la ventana),
   * o `null`.
   */
  lockedIfFailsSeconds: number | null
}

/**
 * Intentos de inicio de sesión por email **y por IP del cliente** (Ruling B-7, ajustado por la
 * auditoría: NV-08 y NV-09): cada intento suma de forma atómica **antes** de verificar la
 * contraseña, así ni los intentos a la vez pasan el tope; con 10 en una ventana de 15 minutos (que
 * arranca con el primero) el par queda bloqueado por el resto de la ventana. Desde otra IP el mismo
 * email sigue entrando, así un anónimo no deja afuera al dueño de la cuenta. Un inicio de sesión
 * correcto borra la cuenta del par. **Falla abierta**: si el almacén no responde, nada queda
 * bloqueado y ninguna operación lanza.
 */
export interface LoginAttemptsPort {
  /**
   * Cuenta un intento, de forma atómica y antes de verificar la contraseña.
   *
   * @param key - Email normalizado e IP del cliente.
   * @returns Si el intento se puede verificar y cuánto bloqueo arranca si falla (los dos `null` si
   *   el almacén no respondió).
   */
  attempt(key: LoginAttemptKey): Promise<LoginAttempt>

  /**
   * Olvida los intentos de un par (después de un inicio de sesión correcto).
   *
   * @param key - Email normalizado e IP del cliente.
   */
  clear(key: LoginAttemptKey): Promise<void>
}

/** Token de inyección del {@link LoginAttemptsPort}. */
export const LOGIN_ATTEMPTS_PORT = Symbol('LOGIN_ATTEMPTS_PORT')
