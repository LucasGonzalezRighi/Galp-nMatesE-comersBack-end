import { describe, expect, it } from 'vitest'

import {
  InstallmentsNotAvailableError,
  IntentNotActiveError,
  InvalidCardTokenError,
  InvalidSignatureError,
  OrderNotPayableError,
  PaymentAttemptNotFoundError,
  PaymentGatewayError,
} from './payments-errors'

describe('errores de pagos', () => {
  it.each([
    ['expired', 'El pedido venció.'],
    ['paid', 'El pedido ya está pagado.'],
    ['preparing', 'El pedido ya está pagado.'],
    ['shipped', 'El pedido ya está pagado.'],
    ['delivered', 'El pedido ya está pagado.'],
    ['cancelled', 'El pedido ya no admite pagos.'],
    ['refunded', 'El pedido ya no admite pagos.'],
  ] as const)('409 order_not_payable con el pedido %s', (status, detail) => {
    expect(new OrderNotPayableError(status)).toMatchObject({
      code: 'order_not_payable',
      status: 409,
      title: 'El pedido no admite un pago nuevo',
      detail,
    })
  })

  it('order_not_payable no acepta un pedido que espera el pago', () => {
    expect(() => new OrderNotPayableError('pending_payment')).toThrow(
      'Un pedido pending_payment admite pagos',
    )
  })

  it('401 invalid_signature', () => {
    expect(new InvalidSignatureError()).toMatchObject({
      code: 'invalid_signature',
      status: 401,
      title: 'Firma inválida',
      detail: 'La firma de la notificación no coincide.',
    })
  })

  it('422 del token y de las cuotas, con el error por campo', () => {
    expect(new InvalidCardTokenError()).toMatchObject({
      code: 'validation_error',
      status: 422,
      detail: 'Revisá los campos marcados.',
      errors: [
        {
          field: 'token',
          code: 'invalid_token',
          message: 'El token de la tarjeta no es válido. Volvé a cargar la tarjeta.',
        },
      ],
    })
    expect(new InstallmentsNotAvailableError()).toMatchObject({
      code: 'validation_error',
      status: 422,
      errors: [
        {
          field: 'installments',
          code: 'invalid_value',
          message: 'Esa cantidad de cuotas no está disponible para esta tarjeta.',
        },
      ],
    })
  })

  it('502 de la pasarela y los del simulador', () => {
    expect(new PaymentGatewayError()).toMatchObject({
      code: 'payment_gateway_error',
      status: 502,
      detail: 'Mercado Pago no respondió. Probá de nuevo en un momento.',
    })
    expect(new IntentNotActiveError()).toMatchObject({
      code: 'intent_not_active',
      status: 409,
      title: 'El intento ya no está activo',
      detail: 'El pago se canceló, venció o ya se resolvió.',
    })
    expect(new PaymentAttemptNotFoundError()).toMatchObject({
      code: 'not_found',
      status: 404,
      detail: 'No existe ese intento de pago.',
    })
  })
})
