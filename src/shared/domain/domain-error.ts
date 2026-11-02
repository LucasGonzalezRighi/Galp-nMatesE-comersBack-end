import { type ChangeNotice, type FieldError, isChangeKind } from './change-notice'

/** Formato de `code`: identificador estable en `snake_case` (el `type` del `Problem`). */
const CODE_PATTERN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/

/** Datos opcionales de un {@link DomainError}. */
export interface DomainErrorOptions {
  /**
   * Segundos a esperar antes de reintentar (entero positivo): el `ProblemFilter` los manda en el
   * header `Retry-After` (por ejemplo, en un 429 por intentos fallidos).
   */
  retryAfterSeconds?: number
  /**
   * Qué cambió en el pedido (`changes` del `Problem`): el `ProblemFilter` los manda en los 409
   * (por ejemplo `stock_changed`).
   */
  changes?: readonly ChangeNotice[]
  /** Errores por campo (`errors` del `Problem`): el `ProblemFilter` los manda en los 422. */
  errors?: readonly FieldError[]
}

/** Texto no vacío (sin contar los espacios). */
function filled(value: unknown): boolean {
  return typeof value === 'string' && value.trim() !== ''
}

/**
 * Copia los avisos de cambio después de validarlos.
 *
 * @throws {TypeError} En español, si un aviso no tiene un tipo del contrato o un mensaje.
 */
function copyChanges(changes: readonly ChangeNotice[]): readonly ChangeNotice[] {
  for (const change of changes) {
    const productOk = change.productId === null || filled(change.productId)
    if (!isChangeKind(change.kind) || !productOk || !filled(change.message)) {
      throw new TypeError('Cada aviso de cambio necesita un tipo del contrato y un mensaje')
    }
  }
  return changes.map((change) => ({ ...change }))
}

/**
 * Copia los errores por campo después de validarlos.
 *
 * @throws {TypeError} En español, si a un error le falta `field`, `code` o `message`.
 */
function copyErrors(errors: readonly FieldError[]): readonly FieldError[] {
  for (const error of errors) {
    if (!filled(error.field) || !filled(error.code) || !filled(error.message)) {
      throw new TypeError('Cada error de campo necesita field, code y message')
    }
  }
  return errors.map((error) => ({ ...error }))
}

/**
 * Error de negocio con lo necesario para responderlo como `application/problem+json`: el
 * `ProblemFilter` usa `code` como `type`, `status` como código HTTP y `detail` como explicación.
 *
 * @example
 * throw new DomainError('stock_changed', 409, 'Un producto del carrito ya no tiene stock.')
 *
 * @example
 * throw new DomainError('stock_changed', 409, detail, 'El stock cambió', {
 *   changes: [{ kind: 'stock', productId, message: 'Mate Imperial se agotó.' }],
 * })
 */
export class DomainError extends Error {
  /** Identificador estable del error, en `snake_case` (por ejemplo `stock_changed`). */
  readonly code: string
  /** Código HTTP con el que se responde (400–599). */
  readonly status: number
  /** Explicación de esta ocurrencia, en español, para mostrarle a la persona. */
  readonly detail: string
  /** Resumen corto en español; si falta, el filtro usa el del código HTTP. */
  readonly title: string | undefined
  /** Segundos para reintentar (header `Retry-After`); `undefined` si no aplica. */
  readonly retryAfterSeconds: number | undefined
  /** Avisos de cambio (`changes` de un 409); `undefined` si no aplica. */
  readonly changes: readonly ChangeNotice[] | undefined
  /** Errores por campo (`errors` de un 422); `undefined` si no aplica. */
  readonly errors: readonly FieldError[] | undefined

  /**
   * @param code - Identificador en `snake_case`.
   * @param status - Código HTTP de error, entero entre 400 y 599.
   * @param detail - Explicación en español, no vacía.
   * @param title - Resumen corto opcional, en español.
   * @param options - Datos opcionales: `retryAfterSeconds`, `changes` y `errors` (se copian).
   * @throws {TypeError} En español, si `code` no es `snake_case`, `detail` está vacío o un aviso
   *   de cambio o un error de campo está incompleto.
   * @throws {RangeError} En español, si `status` no es un código HTTP de error o
   *   `retryAfterSeconds` no es un entero positivo.
   */
  constructor(
    code: string,
    status: number,
    detail: string,
    title?: string,
    options: DomainErrorOptions = {},
  ) {
    if (!CODE_PATTERN.test(code)) {
      throw new TypeError(
        `El código de un error de dominio tiene que ser snake_case (llegó "${code}")`,
      )
    }
    if (!Number.isInteger(status) || status < 400 || status > 599) {
      throw new RangeError(
        `El status de un error de dominio tiene que estar entre 400 y 599 (llegó ${String(status)})`,
      )
    }
    if (detail.trim() === '') {
      throw new TypeError('Un error de dominio necesita un detail')
    }
    const { retryAfterSeconds } = options
    if (
      retryAfterSeconds !== undefined &&
      (!Number.isInteger(retryAfterSeconds) || retryAfterSeconds < 1)
    ) {
      throw new RangeError(
        `retryAfterSeconds tiene que ser un entero positivo (llegó ${String(retryAfterSeconds)})`,
      )
    }
    const changes = options.changes === undefined ? undefined : copyChanges(options.changes)
    const errors = options.errors === undefined ? undefined : copyErrors(options.errors)
    super(detail)
    this.name = 'DomainError'
    this.code = code
    this.status = status
    this.detail = detail
    this.title = title
    this.retryAfterSeconds = retryAfterSeconds
    this.changes = changes
    this.errors = errors
  }
}
