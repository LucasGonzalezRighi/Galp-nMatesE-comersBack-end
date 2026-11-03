import { MPBadRequestError, MPServerError, MPValidationError } from 'mercadopago'
import { describe, expect, it } from 'vitest'

import type { OrderForPayment } from '../../orders/application/ports/order-payments.port'
import type { CardChargeInput, PreferenceInput } from '../application/ports/payment-gateway.port'
import { InvalidCardTokenError, PaymentGatewayError } from '../domain/payments-errors'
import {
  describeMercadoPagoError,
  toExpiredPreferenceBody,
  toGatewayError,
  toInstallmentOptions,
  toMercadoPagoDate,
  toPaymentBody,
  toPreferenceBody,
  toProviderPayment,
} from './mercadopago.mapper'

const NOW = new Date('2026-11-03T15:00:00.000Z')

/** Pedido de un mate ×2 (79998) con envío a domicilio (6500): las líneas y el envío suman el total. */
function order(overrides: Partial<OrderForPayment> = {}): OrderForPayment {
  return {
    id: '019a0000-0000-7000-8000-000000000001',
    number: 'GLP-10001',
    status: 'pending_payment',
    paymentStatus: 'none',
    paymentMethod: 'mp_redirect',
    totalArs: 86498,
    shippingCostArs: 6500,
    accessTokenHash: 'hash',
    reservedUntil: new Date('2026-11-03T15:30:00.000Z'),
    createdAt: NOW,
    customerId: null,
    contact: { email: 'ana@example.com', firstName: 'Ana', lastName: 'Gómez', phone: null },
    lines: [{ id: 'line-1', name: 'Mate Imperial Premium', quantity: 2, totalArs: 79998 }],
    ...overrides,
  }
}

const ORDER = order()

function preferenceInput(overrides: Partial<PreferenceInput> = {}): PreferenceInput {
  return {
    order: ORDER,
    idempotencyKey: '0b5c5a6e-6d1e-4f4f-9a3f-1c2d3e4f5a6b',
    notificationUrl: 'https://api.galpon.test/api/v1/webhooks/mercadopago',
    backUrl: 'https://galpon.test/checkout/resultado?pedido=GLP-10001',
    expiresAt: ORDER.reservedUntil,
    statementDescriptor: 'GALPON MATES',
    ...overrides,
  }
}

function cardInput(overrides: Partial<CardChargeInput> = {}): CardChargeInput {
  return {
    order: ORDER,
    idempotencyKey: '0b5c5a6e-6d1e-4f4f-9a3f-1c2d3e4f5a6b',
    token: 'ff8080814c11e237014c1ff593b57b4d',
    paymentMethodId: 'visa',
    issuerId: '310',
    installments: 3,
    payer: { email: 'ana@example.com', identification: { type: 'DNI', number: '12345678' } },
    notificationUrl: 'https://api.galpon.test/api/v1/webhooks/mercadopago',
    statementDescriptor: 'GALPON MATES',
    ...overrides,
  }
}

describe('toMercadoPagoDate', () => {
  it('escribe la hora de Argentina con milisegundos y offset -03:00', () => {
    expect(toMercadoPagoDate(new Date('2026-11-03T15:30:00.000Z'))).toBe(
      '2026-11-03T12:30:00.000-03:00',
    )
    expect(toMercadoPagoDate(new Date('2026-11-04T01:05:09.123Z'))).toBe(
      '2026-11-03T22:05:09.123-03:00',
    )
  })

  it('una fecha inválida es un error', () => {
    expect(() => toMercadoPagoDate(new Date('x'))).toThrow('no es una fecha válida')
  })
})

describe('toPreferenceBody (Ruling B-35)', () => {
  it('arma ítems por línea, el envío, el pagador, las URLs, la vigencia y los medios', () => {
    expect(toPreferenceBody(preferenceInput(), NOW)).toEqual({
      items: [
        {
          id: 'line-1',
          title: 'Mate Imperial Premium',
          quantity: 2,
          unit_price: 39999,
          currency_id: 'ARS',
        },
        { id: 'envio', title: 'Envío', quantity: 1, unit_price: 6500, currency_id: 'ARS' },
      ],
      payer: { email: 'ana@example.com', name: 'Ana', surname: 'Gómez' },
      external_reference: 'GLP-10001',
      notification_url: 'https://api.galpon.test/api/v1/webhooks/mercadopago',
      back_urls: {
        success: 'https://galpon.test/checkout/resultado?pedido=GLP-10001',
        pending: 'https://galpon.test/checkout/resultado?pedido=GLP-10001',
        failure: 'https://galpon.test/checkout/resultado?pedido=GLP-10001',
      },
      auto_return: 'approved',
      expires: true,
      expiration_date_from: '2026-11-03T12:00:00.000-03:00',
      expiration_date_to: '2026-11-03T12:30:00.000-03:00',
      statement_descriptor: 'GALPON MATES',
      metadata: { orderId: ORDER.id, number: 'GLP-10001' },
      payment_methods: {
        excluded_payment_types: [{ id: 'ticket' }, { id: 'atm' }],
        installments: 12,
      },
      binary_mode: false,
    })
  })

  it('sin notification_url (simulado) no la manda, y sin envío no agrega el ítem', () => {
    const body = toPreferenceBody(
      preferenceInput({
        notificationUrl: null,
        order: order({
          shippingCostArs: 0,
          totalArs: 79998,
          lines: [{ id: 'line-1', name: 'Mate', quantity: 2, totalArs: 79998 }],
        }),
      }),
      NOW,
    )

    expect(body).not.toHaveProperty('notification_url')
    expect(body.items).toEqual([
      { id: 'line-1', title: 'Mate', quantity: 2, unit_price: 39999, currency_id: 'ARS' },
    ])
  })

  it('una línea que no se divide en pesos enteros va como un ítem con su total', () => {
    const body = toPreferenceBody(
      preferenceInput({
        order: order({
          shippingCostArs: 0,
          totalArs: 100,
          lines: [{ id: 'line-1', name: 'Bombilla', quantity: 3, totalArs: 100 }],
        }),
      }),
      NOW,
    )

    expect(body.items).toEqual([
      { id: 'line-1', title: 'Bombilla ×3', quantity: 1, unit_price: 100, currency_id: 'ARS' },
    ])
  })

  it('si las líneas no suman el total, cobra el total en un solo ítem', () => {
    const body = toPreferenceBody(
      preferenceInput({
        order: order({
          shippingCostArs: 0,
          totalArs: 90000,
          lines: [{ id: 'line-1', name: 'Mate', quantity: 2, totalArs: 79998 }],
        }),
      }),
      NOW,
    )

    expect(body.items).toEqual([
      {
        id: 'GLP-10001',
        title: 'Pedido GLP-10001 · Galpón Mates',
        quantity: 1,
        unit_price: 90000,
        currency_id: 'ARS',
      },
    ])
  })
})

describe('toExpiredPreferenceBody', () => {
  it('vence la preferencia con expiration_date_to en el pasado', () => {
    expect(toExpiredPreferenceBody(NOW)).toEqual({
      expires: true,
      expiration_date_from: '2026-11-03T11:59:00.000-03:00',
      expiration_date_to: '2026-11-03T11:59:59.000-03:00',
    })
  })
})

describe('toPaymentBody (Ruling B-35)', () => {
  it('cobra el total del pedido con 3DS opcional, captura y sin modo binario', () => {
    expect(toPaymentBody(cardInput())).toEqual({
      token: 'ff8080814c11e237014c1ff593b57b4d',
      transaction_amount: 86498,
      installments: 3,
      payment_method_id: 'visa',
      issuer_id: 310,
      payer: { email: 'ana@example.com', identification: { type: 'DNI', number: '12345678' } },
      description: 'Pedido GLP-10001 · Galpón Mates',
      external_reference: 'GLP-10001',
      notification_url: 'https://api.galpon.test/api/v1/webhooks/mercadopago',
      metadata: { orderId: ORDER.id, number: 'GLP-10001' },
      statement_descriptor: 'GALPON MATES',
      capture: true,
      binary_mode: false,
      three_d_secure_mode: 'optional',
      additional_info: {
        items: [
          {
            id: 'line-1',
            title: 'Mate Imperial Premium',
            quantity: 2,
            unit_price: 39999,
            currency_id: 'ARS',
          },
        ],
      },
    })
  })

  it('sin banco emisor ni notification_url no los manda', () => {
    const body = toPaymentBody(cardInput({ issuerId: null, notificationUrl: null }))

    expect(body).not.toHaveProperty('issuer_id')
    expect(body).not.toHaveProperty('notification_url')
  })
})

describe('toProviderPayment', () => {
  it('lee un pago aprobado (respuesta de POST /v1/payments)', () => {
    const response = {
      id: 1234567890,
      status: 'approved',
      status_detail: 'accredited',
      transaction_amount: 86498,
      transaction_amount_refunded: 0,
      installments: 3,
      payment_type_id: 'credit_card',
      payment_method_id: 'visa',
      issuer_id: '310',
      external_reference: 'GLP-10001',
      date_approved: '2026-11-03T12:01:02.000-03:00',
      card: { first_six_digits: '450995', last_four_digits: '3704' },
    }

    expect(toProviderPayment(response)).toEqual({
      providerPaymentId: '1234567890',
      status: 'approved',
      statusDetail: 'accredited',
      amountArs: 86498,
      refundedArs: 0,
      installments: 3,
      paymentTypeId: 'credit_card',
      paymentMethodId: 'visa',
      cardLastFour: '3704',
      issuerId: '310',
      externalReference: 'GLP-10001',
      challengeUrl: null,
      approvedAt: new Date('2026-11-03T15:01:02.000Z'),
    })
  })

  it('con desafío 3DS toma three_ds_info.external_resource_url', () => {
    const response = {
      id: 1234567891,
      status: 'pending',
      status_detail: 'pending_challenge',
      transaction_amount: 86498,
      three_ds_info: {
        external_resource_url:
          'https://api.mercadopago.com/cardholder_authenticator/v2/prod/browser-challenges',
        creq: 'eyJ0aHJlZURTU2VydmVyVHJhbnNJRCI6...',
      },
    }

    const payment = toProviderPayment(response)

    expect(payment).toMatchObject({
      providerPaymentId: '1234567891',
      status: 'pending',
      statusDetail: 'pending_challenge',
      challengeUrl:
        'https://api.mercadopago.com/cardholder_authenticator/v2/prod/browser-challenges',
      approvedAt: null,
      cardLastFour: null,
      issuerId: null,
      refundedArs: 0,
    })
  })

  it('redondea montos con decimales y lee la devolución parcial', () => {
    const payment = toProviderPayment({
      id: 1,
      status: 'approved',
      status_detail: 'partially_refunded',
      transaction_amount: 1109.7,
      transaction_amount_refunded: 369.9,
      issuer_id: 310,
    })

    expect(payment).toMatchObject({ amountArs: 1110, refundedArs: 370, issuerId: '310' })
  })

  it('un pago sin id es un error de la pasarela', () => {
    expect(() => toProviderPayment({ status: 'approved' })).toThrow(PaymentGatewayError)
  })
})

describe('toInstallmentOptions (Ruling B-50)', () => {
  const RESPONSE = [
    {
      payment_method_id: 'visa',
      payment_type_id: 'credit_card',
      payer_costs: [
        {
          installments: 1,
          installment_rate: 0,
          labels: ['CFT_0,00%|TEA_0,00%'],
          recommended_message: '1 cuota de $ 86.498,00 ($ 86.498,00)',
          installment_amount: 86498,
          total_amount: 86498,
        },
        {
          installments: 3,
          installment_rate: 21.73,
          labels: ['recommended_installment', 'CFT_45,90%|TEA_38,00%'],
          recommended_message: '3 cuotas de $ 35.097,61 ($ 105.292,83)',
          installment_amount: 35097.61,
          total_amount: 105292.83,
        },
      ],
    },
  ]

  it('mapea cada payer_cost con el CFT y la TEA de labels y redondea los montos', () => {
    expect(toInstallmentOptions(RESPONSE, 'credit_card')).toEqual([
      {
        installments: 1,
        installmentAmountArs: 86498,
        totalArs: 86498,
        cftPercent: 0,
        teaPercent: 0,
        label: '1 cuota de $ 86.498,00 ($ 86.498,00)',
      },
      {
        installments: 3,
        installmentAmountArs: 35098,
        totalArs: 105293,
        cftPercent: 45.9,
        teaPercent: 38,
        label: '3 cuotas de $ 35.097,61 ($ 105.292,83)',
      },
    ])
  })

  it('con débito deja solo la opción de 1 pago', () => {
    expect(
      toInstallmentOptions(RESPONSE, 'debit_card').map((option) => option.installments),
    ).toEqual([1])
  })

  it('una respuesta vacía no tiene opciones; una mal formada es un error de la pasarela', () => {
    expect(toInstallmentOptions([], 'credit_card')).toEqual([])
    expect(() => toInstallmentOptions({ error: 'bad_request' }, 'credit_card')).toThrow(
      PaymentGatewayError,
    )
  })
})

describe('errores del SDK', () => {
  const tokenCause = (code: number | string) =>
    new MPBadRequestError({
      status: 400,
      error: 'bad_request',
      message: 'Invalid card_token_id',
      cause: [{ code, description: 'Invalid card_token_id' }],
    })

  it.each([2006, 2062, 3003, 3006, 3008, 4000, '3003'])(
    'la causa %s del token da InvalidCardTokenError',
    (code) => {
      expect(toGatewayError(tokenCause(code))).toBeInstanceOf(InvalidCardTokenError)
    },
  )

  it('un 422 con causa de token también, y cualquier otro error de MP da 502', () => {
    const validation = new MPValidationError({
      status: 422,
      error: 'unprocessable_entity',
      cause: [{ code: 2062, description: 'Invalid card token' }],
    })

    expect(toGatewayError(validation)).toBeInstanceOf(InvalidCardTokenError)
    expect(toGatewayError(tokenCause(4033))).toBeInstanceOf(PaymentGatewayError)
    expect(
      toGatewayError(new MPServerError({ status: 500, error: 'internal_error' })),
    ).toBeInstanceOf(PaymentGatewayError)
    expect(toGatewayError(new Error('socket hang up'))).toBeInstanceOf(PaymentGatewayError)
  })

  it('un error propio ya traducido pasa tal cual', () => {
    const error = new InvalidCardTokenError()

    expect(toGatewayError(error)).toBe(error)
  })

  it('el texto para el log tiene status, error y las causas, nada más', () => {
    const error = new MPBadRequestError({
      status: 400,
      error: 'bad_request',
      message: 'token ff8080814c11e237014c1ff593b57b4d inválido',
      cause: [{ code: 3003, description: 'Invalid card_token_id' }],
    })

    expect(describeMercadoPagoError(error)).toBe(
      'status 400, error bad_request, causas [3003: Invalid card_token_id]',
    )
    expect(describeMercadoPagoError(new Error('socket hang up'))).toBe('socket hang up')
  })
})
