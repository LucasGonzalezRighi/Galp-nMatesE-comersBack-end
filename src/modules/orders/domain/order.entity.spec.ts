import { describe, expect, it } from 'vitest'

import type { ShippingOption } from '../../settings/domain/store-settings.entity'
import { orderCreatedEvent, orderExpiredEvent, orderPaidEvent } from './order-events'
import {
  isExpirable,
  isRefundable,
  markExpired,
  markPaid,
  markRefunded,
  type Order,
  type OrderDraft,
  placeOrder,
  reservedUntilFor,
} from './order.entity'
import { CartValidationError, ShippingMethodUnavailableError } from './orders-errors'
import { findShippingOption, orderShippingAddress, requirePostalCode } from './shipping'

const CREATED_AT = new Date('2026-11-02T12:00:00.000Z')
const MINUTE = 60_000

function draft(): OrderDraft {
  return {
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
  }
}

function placed(changes: Partial<Order> = {}): Order {
  return { ...placeOrder(draft(), 'GLP-10001'), ...changes }
}

describe('pedido', () => {
  it('reserva 30 minutos desde la creación', () => {
    expect(reservedUntilFor(CREATED_AT)).toEqual(new Date('2026-11-02T12:30:00.000Z'))
    expect(() => reservedUntilFor(new Date('x'))).toThrow(TypeError)
  })

  it('nace en pending_payment, sin pago, sin despacho y con la primera fila del historial', () => {
    const order = placed()

    expect(order).toMatchObject({
      number: 'GLP-10001',
      status: 'pending_payment',
      paymentStatus: 'none',
      payment: null,
      tracking: null,
      history: [{ status: 'pending_payment', at: CREATED_AT, note: null }],
    })
    expect(order).not.toHaveProperty('reservation')
    expect(() => placeOrder(draft(), 'GLP-1')).toThrow(TypeError)
  })

  it('vence en reservedUntil si sigue esperando un pago que no está en curso', () => {
    const at29 = new Date(CREATED_AT.getTime() + 29 * MINUTE)
    const at30 = new Date(CREATED_AT.getTime() + 30 * MINUTE)

    expect(isExpirable(placed(), at29)).toBe(false)
    expect(isExpirable(placed(), at30)).toBe(true)
    expect(isExpirable(placed({ paymentStatus: 'rejected' }), at30)).toBe(true)
    expect(isExpirable(placed({ paymentStatus: 'cancelled' }), at30)).toBe(true)
    expect(isExpirable(placed({ paymentStatus: 'pending' }), at30)).toBe(false)
    expect(isExpirable(placed({ paymentStatus: 'action_required' }), at30)).toBe(false)
    expect(isExpirable(placed({ status: 'paid' }), at30)).toBe(false)
  })

  it('al vencer suma la fila expired con la fecha de reservedUntil', () => {
    const now = new Date(CREATED_AT.getTime() + 45 * MINUTE)
    const expired = markExpired(placed(), now)

    expect(expired.status).toBe('expired')
    expect(expired.history.at(-1)).toEqual({
      status: 'expired',
      at: reservedUntilFor(CREATED_AT),
      note: null,
    })
    expect(() => markExpired(expired, now)).toThrow(TypeError)
  })

  it('al pagarse pasa a paid con el pago aprobado y suma la fila paid en paidAt', () => {
    const paidAt = new Date(CREATED_AT.getTime() + 10 * MINUTE)
    const paid = markPaid(placed({ paymentStatus: 'pending' }), paidAt)

    expect(paid.status).toBe('paid')
    expect(paid.paymentStatus).toBe('approved')
    expect(paid.history).toEqual([
      { status: 'pending_payment', at: CREATED_AT, note: null },
      { status: 'paid', at: paidAt, note: null },
    ])
    expect(() => markPaid(paid, paidAt)).toThrow('El pedido GLP-10001 no se puede marcar pagado')
    expect(() => markPaid(placed({ status: 'expired' }), paidAt)).toThrow(TypeError)
    expect(() => markPaid(placed(), new Date('x'))).toThrow('El momento del pago')
  })

  it('se devuelve solo si está paid, preparing, shipped o delivered; el pago queda refunded', () => {
    const at = new Date(CREATED_AT.getTime() + 60 * MINUTE)
    const paid = markPaid(placed(), new Date(CREATED_AT.getTime() + 10 * MINUTE))
    const refunded = markRefunded(paid, at)

    expect(refunded.status).toBe('refunded')
    expect(refunded.paymentStatus).toBe('refunded')
    expect(refunded.history.at(-1)).toEqual({ status: 'refunded', at, note: null })
    for (const status of ['paid', 'preparing', 'shipped', 'delivered'] as const) {
      expect(isRefundable(placed({ status }))).toBe(true)
    }
    for (const status of ['pending_payment', 'cancelled', 'expired', 'refunded'] as const) {
      expect(isRefundable(placed({ status }))).toBe(false)
    }
    expect(() => markRefunded(placed(), at)).toThrow('El pedido GLP-10001 no se puede devolver')
    expect(() => markRefunded(paid, new Date('x'))).toThrow('El momento de la devolución')
  })

  it('arma los eventos order.created y order.expired con el número como agregado', () => {
    const order = placed({ customerId: 'cus-1' })

    expect(orderCreatedEvent(order)).toEqual({
      type: 'order.created',
      aggregateType: 'order',
      aggregateId: 'GLP-10001',
      payload: {
        orderId: 'ord-1',
        number: 'GLP-10001',
        customerId: 'cus-1',
        totalArs: 39999,
        reservedUntil: '2026-11-02T12:30:00.000Z',
      },
    })
    expect(orderExpiredEvent(order)).toEqual({
      type: 'order.expired',
      aggregateType: 'order',
      aggregateId: 'GLP-10001',
      payload: { orderId: 'ord-1', number: 'GLP-10001' },
    })
    expect(orderPaidEvent(order, new Date('2026-11-02T12:10:00.000Z'))).toEqual({
      type: 'order.paid',
      aggregateType: 'order',
      aggregateId: 'GLP-10001',
      payload: { orderId: 'ord-1', number: 'GLP-10001', paidAt: '2026-11-02T12:10:00.000Z' },
    })
  })
})

describe('envío', () => {
  const options: ShippingOption[] = [
    { method: 'home', label: 'Envío a domicilio', costArs: 6500, eta: '3 a 6', enabled: true },
    { method: 'branch', label: 'Envío a sucursal', costArs: 4900, eta: '3 a 6', enabled: false },
  ]
  const address = {
    street: 'Av. Corrientes',
    number: '1234',
    apartment: null,
    postalCode: 'C1043',
    city: 'CABA',
    province: 'CABA',
  } as const

  it('copia la dirección según el método', () => {
    expect(orderShippingAddress('home', address)).toEqual(address)
    expect(orderShippingAddress('branch', address)).toEqual({
      postalCode: 'C1043',
      city: 'CABA',
      province: 'CABA',
    })
    expect(orderShippingAddress('pickup', address)).toBeNull()
    expect(() => orderShippingAddress('home', null)).toThrow(TypeError)
    expect(() => orderShippingAddress('branch', null)).toThrow(TypeError)
  })

  it('devuelve la opción habilitada o un 422 en el campo pedido', () => {
    expect(findShippingOption(options, 'home', 'shipping.method').costArs).toBe(6500)
    for (const method of ['branch', 'pickup'] as const) {
      expect(() => findShippingOption(options, method, 'method')).toThrow(
        ShippingMethodUnavailableError,
      )
    }
    expect(() => findShippingOption(options, 'branch', 'shipping.method')).toThrow(
      expect.objectContaining({
        status: 422,
        code: 'validation_error',
        detail: 'Ese método de envío ya no está disponible. Volvé al paso de envío y elegí otro.',
        errors: [
          {
            field: 'shipping.method',
            code: 'unavailable',
            message: 'Ese método de envío no está disponible.',
          },
        ],
      }),
    )
  })

  it('pide el código postal salvo en el retiro', () => {
    expect(() => {
      requirePostalCode('pickup', null)
    }).not.toThrow()
    expect(() => {
      requirePostalCode('home', 'C1043')
    }).not.toThrow()
    expect(() => {
      requirePostalCode('branch', null)
    }).toThrow(CartValidationError)
    expect(() => {
      requirePostalCode('home', null)
    }).toThrow(
      expect.objectContaining({
        errors: [{ field: 'postalCode', code: 'required', message: 'Ingresá el código postal.' }],
      }),
    )
  })
})
