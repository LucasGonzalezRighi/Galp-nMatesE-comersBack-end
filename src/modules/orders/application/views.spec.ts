import { describe, expect, it } from 'vitest'

import {
  type Order,
  type OrderPaymentInfo,
  placeOrder,
  reservedUntilFor,
} from '../domain/order.entity'
import { toOrderView } from './views'

const CREATED_AT = new Date('2026-11-02T12:00:00.000Z')

/** Pedido de un mate con retiro, sin intentos de pago. */
function order(changes: Partial<Order> = {}): Order {
  return {
    ...placeOrder(
      {
        id: 'ord-1',
        number: null,
        customerId: null,
        contact: { email: 'lucia@ejemplo.com', firstName: 'Lucía', lastName: 'Pérez', phone: null },
        shipping: { method: 'pickup', address: null, costArs: 0, eta: 'Coordinamos por mail' },
        lines: [],
        reservation: [{ productId: 'prd-a', quantity: 1 }],
        itemsGrossArs: 39999,
        kitSavingsArs: 0,
        subtotalArs: 39999,
        totalArs: 39999,
        kitDiscountPercent: 10,
        paymentMethod: 'mp_redirect',
        accessTokenHash: 'hash',
        createdAt: CREATED_AT,
        reservedUntil: reservedUntilFor(CREATED_AT),
      },
      'GLP-10001',
    ),
    ...changes,
  }
}

/** Intento con tarjeta en 3-D Secure. */
const CHALLENGED: OrderPaymentInfo = {
  method: 'card',
  status: 'action_required',
  installments: 3,
  paymentTypeId: 'credit_card',
  lastFour: '3704',
  statusDetail: 'pending_challenge',
  providerPaymentId: '1234567890',
  challengeUrl: 'https://www.mercadopago.com.ar/3ds/challenge?id=abc123',
}

describe('toOrderView: pago', () => {
  it('sin intentos: la forma del checkout y null explícito en todo lo demás', () => {
    expect(toOrderView(order()).payment).toEqual({
      method: 'mp_redirect',
      installments: null,
      paymentTypeId: null,
      lastFour: null,
      statusDetail: null,
      mpPaymentId: null,
      challenge: null,
    })
  })

  it('con el último intento: sus datos y el desafío mientras está en action_required', () => {
    expect(toOrderView(order({ payment: CHALLENGED })).payment).toEqual({
      method: 'card',
      installments: 3,
      paymentTypeId: 'credit_card',
      lastFour: '3704',
      statusDetail: 'pending_challenge',
      mpPaymentId: '1234567890',
      challenge: { url: 'https://www.mercadopago.com.ar/3ds/challenge?id=abc123' },
    })
  })

  it('el desafío deja de salir cuando el pago se resuelve', () => {
    const approved = { ...CHALLENGED, status: 'approved', statusDetail: 'accredited' } as const

    expect(toOrderView(order({ payment: approved })).payment).toEqual({
      method: 'card',
      installments: 3,
      paymentTypeId: 'credit_card',
      lastFour: '3704',
      statusDetail: 'accredited',
      mpPaymentId: '1234567890',
      challenge: null,
    })
  })

  it('un action_required sin dirección guardada no inventa un desafío', () => {
    const view = toOrderView(order({ payment: { ...CHALLENGED, challengeUrl: null } }))

    expect(view.payment.challenge).toBeNull()
  })

  it('una preferencia sin pago: null en lo que Mercado Pago todavía no informó', () => {
    const preference: OrderPaymentInfo = {
      method: 'mp_redirect',
      status: 'none',
      installments: null,
      paymentTypeId: null,
      lastFour: null,
      statusDetail: null,
      providerPaymentId: null,
      challengeUrl: null,
    }

    expect(toOrderView(order({ payment: preference })).payment).toEqual({
      method: 'mp_redirect',
      installments: null,
      paymentTypeId: null,
      lastFour: null,
      statusDetail: null,
      mpPaymentId: null,
      challenge: null,
    })
  })
})
