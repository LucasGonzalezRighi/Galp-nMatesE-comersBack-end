import type { ChangeNotice, FieldError } from '../../../shared/domain/change-notice'
import { DomainError } from '../../../shared/domain/domain-error'
import { type AdminOrderTarget, STATUS_TEXT } from './admin-order-transitions'
import type { OrderStatus } from './order-status'

/** Motivos del 409 de `POST /orders`, en orden de precedencia. */
export type OrderConflictCode = 'stock_changed' | 'price_changed' | 'total_changed'

/** Títulos de cada 409 de pedido. */
const CONFLICT_TITLES: Record<OrderConflictCode, string> = {
  stock_changed: 'El stock cambió',
  price_changed: 'Cambiaron los precios',
  total_changed: 'El total cambió',
}

/** `detail` común de los 409 de pedido. */
export const ORDER_CONFLICT_DETAIL =
  'El pedido cambió desde que armaste el resumen. Revisalo antes de pagar.'

/** `detail` de los 422 de validación (el del contrato). */
export const VALIDATION_DETAIL = 'Revisá los campos marcados.'

/**
 * 409 de `POST /orders`: cambió el stock, un precio o el total desde que la persona armó el
 * resumen. No se crea nada y `changes` dice qué cambió.
 */
export class OrderConflictError extends DomainError {
  /**
   * @param code - `stock_changed`, `price_changed` o `total_changed`.
   * @param changes - Avisos para la tienda (al menos uno).
   * @throws {TypeError} En español, si no hay avisos o alguno está incompleto.
   */
  constructor(code: OrderConflictCode, changes: readonly ChangeNotice[]) {
    if (changes.length === 0) {
      throw new TypeError('Un conflicto de pedido necesita al menos un aviso de cambio')
    }
    super(code, 409, ORDER_CONFLICT_DETAIL, CONFLICT_TITLES[code], { changes })
    this.name = 'OrderConflictError'
  }
}

/**
 * 404 `not_found`: el pedido no existe o quien pregunta no lo puede ver. Es el mismo para un
 * número inexistente, un token ajeno o una sesión ajena, así no se revela si el número existe.
 */
export class OrderNotFoundError extends DomainError {
  constructor() {
    super('not_found', 404, 'No encontramos ese pedido.')
    this.name = 'OrderNotFoundError'
  }
}

/** 404 `not_found` del dashboard: el número no es de ningún pedido (texto del mock del admin). */
export class AdminOrderNotFoundError extends DomainError {
  constructor() {
    super('not_found', 404, 'No existe ese pedido.')
    this.name = 'AdminOrderNotFoundError'
  }
}

/** `detail` del 409 `payment_in_progress` (el del mock). */
export const PAYMENT_IN_PROGRESS_DETAIL =
  'Hay un pago en curso: esperá a que se resuelva para cancelar el pedido.'

/**
 * 409 `invalid_status_transition`: el pedido no puede pasar a ese estado desde el que tiene
 * (`El pedido está pagado: no puede pasar a cancelado.`).
 */
export class InvalidStatusTransitionError extends DomainError {
  /**
   * @param from - Estado actual del pedido.
   * @param to - Estado que pidió el dashboard.
   * @throws {TypeError} En español, si alguno de los dos estados no existe.
   */
  constructor(from: OrderStatus, to: AdminOrderTarget) {
    const fromText = STATUS_TEXT[from] as string | undefined
    const toText = STATUS_TEXT[to] as string | undefined
    if (fromText === undefined || toText === undefined) {
      throw new TypeError(
        `Una transición inválida necesita estados conocidos (llegó ${from} → ${to})`,
      )
    }
    super(
      'invalid_status_transition',
      409,
      `El pedido está ${fromText}: no puede pasar a ${toText}.`,
      'Transición inválida',
    )
    this.name = 'InvalidStatusTransitionError'
  }
}

/** 409 `payment_in_progress`: se pidió cancelar un pedido con un pago `pending` o `action_required`. */
export class PaymentInProgressError extends DomainError {
  constructor() {
    super('payment_in_progress', 409, PAYMENT_IN_PROGRESS_DETAIL, 'Hay un pago en curso')
    this.name = 'PaymentInProgressError'
  }
}

/** 422 `validation_error` del carrito o del checkout, con los errores por campo en `errors`. */
export class CartValidationError extends DomainError {
  /**
   * @param errors - Errores por campo (al menos uno).
   * @param detail - Explicación general; por defecto `Revisá los campos marcados.`.
   * @throws {TypeError} En español, si no hay errores o alguno está incompleto.
   */
  constructor(errors: readonly FieldError[], detail: string = VALIDATION_DETAIL) {
    if (errors.length === 0) {
      throw new TypeError('Un error de validación necesita al menos un error de campo')
    }
    super('validation_error', 422, detail, undefined, { errors })
    this.name = 'CartValidationError'
  }
}

/** 422: el método de envío elegido está deshabilitado en los ajustes. */
export class ShippingMethodUnavailableError extends CartValidationError {
  /**
   * @param field - Campo del método: `shipping.method` en `POST /orders` y `method` en
   *   `POST /shipping/quote`.
   */
  constructor(field: 'shipping.method' | 'method') {
    super(
      [{ field, code: 'unavailable', message: 'Ese método de envío no está disponible.' }],
      'Ese método de envío ya no está disponible. Volvé al paso de envío y elegí otro.',
    )
    this.name = 'ShippingMethodUnavailableError'
  }
}

/** 422 en `items`: algún total pasa del máximo de `TotalArs` (2.147.483.647). */
export class CartTotalTooBigError extends CartValidationError {
  constructor() {
    super([
      { field: 'items', code: 'too_big', message: 'El total del carrito es demasiado grande.' },
    ])
    this.name = 'CartTotalTooBigError'
  }
}
