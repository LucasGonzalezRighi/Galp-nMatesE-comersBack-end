/** Resultado exitoso de una operación que puede fallar sin lanzar. */
export interface Ok<T> {
  /** Discriminante: la operación salió bien. */
  readonly ok: true
  /** El valor obtenido. */
  readonly value: T
}

/** Resultado fallido de una operación que puede fallar sin lanzar. */
export interface Err<E> {
  /** Discriminante: la operación falló. */
  readonly ok: false
  /** El motivo del fallo. */
  readonly error: E
}

/** Resultado de una operación de dominio: `Ok` con el valor o `Err` con el motivo. */
export type Result<T, E> = Ok<T> | Err<E>

/**
 * Arma un resultado exitoso.
 *
 * @param value - El valor obtenido.
 * @returns `{ ok: true, value }`.
 */
export function ok<T>(value: T): Ok<T> {
  return { ok: true, value }
}

/**
 * Arma un resultado fallido.
 *
 * @param error - El motivo del fallo.
 * @returns `{ ok: false, error }`.
 */
export function err<E>(error: E): Err<E> {
  return { ok: false, error }
}
