/** Formato de `code`: identificador estable en `snake_case` (el `type` del `Problem`). */
const CODE_PATTERN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/

/**
 * Error de negocio con lo necesario para responderlo como `application/problem+json`: el
 * `ProblemFilter` usa `code` como `type`, `status` como código HTTP y `detail` como explicación.
 *
 * @example
 * throw new DomainError('stock_changed', 409, 'Un producto del carrito ya no tiene stock.')
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

  /**
   * @param code - Identificador en `snake_case`.
   * @param status - Código HTTP de error, entero entre 400 y 599.
   * @param detail - Explicación en español, no vacía.
   * @param title - Resumen corto opcional, en español.
   * @throws {TypeError} En español, si `code` no es `snake_case` o `detail` está vacío.
   * @throws {RangeError} En español, si `status` no es un código HTTP de error.
   */
  constructor(code: string, status: number, detail: string, title?: string) {
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
    super(detail)
    this.name = 'DomainError'
    this.code = code
    this.status = status
    this.detail = detail
    this.title = title
  }
}
