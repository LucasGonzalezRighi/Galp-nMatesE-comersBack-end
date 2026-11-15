import { DomainError } from '../../../shared/domain/domain-error'
import type { OrderStatus } from '../../orders/domain/order-status'

/** `detail` de los 422 de validación (el del contrato). */
const VALIDATION_DETAIL = 'Revisá los campos marcados.'

/** Estados del pedido que cuentan como "ya pagado" para el `detail` de `order_not_payable`. */
const PAID_ORDER_STATUSES: readonly OrderStatus[] = ['paid', 'preparing', 'shipped', 'delivered']

/**
 * 409 `order_not_payable`: el pedido no está `pending_payment`, así que no admite un pago nuevo
 * (ni cancelar el intento ni consultar cuotas). El `detail` depende del estado, como en el mock.
 */
export class OrderNotPayableError extends DomainError {
  /**
   * @param orderStatus - Estado actual del pedido.
   * @throws {TypeError} En español, si el pedido sigue `pending_payment`.
   */
  constructor(orderStatus: OrderStatus) {
    if (orderStatus === 'pending_payment') {
      throw new TypeError('Un pedido pending_payment admite pagos')
    }
    const detail =
      orderStatus === 'expired'
        ? 'El pedido venció.'
        : PAID_ORDER_STATUSES.includes(orderStatus)
          ? 'El pedido ya está pagado.'
          : 'El pedido ya no admite pagos.'
    super('order_not_payable', 409, detail, 'El pedido no admite un pago nuevo')
    this.name = 'OrderNotPayableError'
  }
}

/**
 * 409 `order_not_payable` (auditoría NV-16): el pedido ya tuvo `MAX_PAYMENT_ATTEMPTS_PER_ORDER`
 * intentos de pago y no admite otro (la tienda descarta el pedido y la persona arma uno nuevo).
 */
export class PaymentAttemptsExhaustedError extends DomainError {
  constructor() {
    super(
      'order_not_payable',
      409,
      'El pedido llegó al máximo de intentos de pago. Armalo de nuevo para pagar.',
      'El pedido no admite un pago nuevo',
    )
    this.name = 'PaymentAttemptsExhaustedError'
  }
}

/** 401 `invalid_signature`: la firma `x-signature` del webhook no coincide (o no hay secreto). */
export class InvalidSignatureError extends DomainError {
  constructor() {
    super('invalid_signature', 401, 'La firma de la notificación no coincide.', 'Firma inválida')
    this.name = 'InvalidSignatureError'
  }
}

/** 422 `validation_error` en `token`: el token de la tarjeta no sirve (vencido, usado o mal formado). */
export class InvalidCardTokenError extends DomainError {
  constructor() {
    super('validation_error', 422, VALIDATION_DETAIL, undefined, {
      errors: [
        {
          field: 'token',
          code: 'invalid_token',
          message: 'El token de la tarjeta no es válido. Volvé a cargar la tarjeta.',
        },
      ],
    })
    this.name = 'InvalidCardTokenError'
  }
}

/** 422 `validation_error` en `installments`: la pasarela no ofrece esas cuotas para la tarjeta. */
export class InstallmentsNotAvailableError extends DomainError {
  constructor() {
    super('validation_error', 422, VALIDATION_DETAIL, undefined, {
      errors: [
        {
          field: 'installments',
          code: 'invalid_value',
          message: 'Esa cantidad de cuotas no está disponible para esta tarjeta.',
        },
      ],
    })
    this.name = 'InstallmentsNotAvailableError'
  }
}

/**
 * 422 `idempotency_key_reused`: la `Idempotency-Key` ya es de un intento de otro pedido o de otra
 * forma de pago. En la práctica el interceptor de idempotencia lo frena antes (el hash del pedido
 * cambia); esto cubre lo que llegue igual, con el mismo `type` y el mismo texto.
 */
export class IdempotencyKeyReusedError extends DomainError {
  constructor() {
    super(
      'idempotency_key_reused',
      422,
      'La Idempotency-Key ya se usó con otros datos. Generá una nueva para este intento.',
      'La clave ya se usó',
    )
    this.name = 'IdempotencyKeyReusedError'
  }
}

/** 502 `payment_gateway_error`: Mercado Pago falló o no respondió a tiempo. */
export class PaymentGatewayError extends DomainError {
  constructor() {
    super(
      'payment_gateway_error',
      502,
      'Mercado Pago no respondió. Probá de nuevo en un momento.',
      'Error de Mercado Pago',
    )
    this.name = 'PaymentGatewayError'
  }
}

/** 409 `intent_not_active` del simulador: el intento se canceló, venció o ya se resolvió. */
export class IntentNotActiveError extends DomainError {
  constructor() {
    super(
      'intent_not_active',
      409,
      'El pago se canceló, venció o ya se resolvió.',
      'El intento ya no está activo',
    )
    this.name = 'IntentNotActiveError'
  }
}

/** 404 `not_found` del simulador: no existe un intento con esa preferencia o ese pago. */
export class PaymentAttemptNotFoundError extends DomainError {
  constructor() {
    super('not_found', 404, 'No existe ese intento de pago.')
    this.name = 'PaymentAttemptNotFoundError'
  }
}
