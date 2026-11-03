import { describe, expect, it } from 'vitest'

import { Prisma } from '../../../generated/prisma/client'
import {
  cartItemOptionsJson,
  type OrderRow,
  shippingAddressJson,
  toCartItemOptions,
  toOrder,
  toShippingAddress,
} from './order.mapper'

const CREATED_AT = new Date('2026-11-02T12:00:00.000Z')
const RESERVED_UNTIL = new Date('2026-11-02T12:30:00.000Z')

const HOME = {
  street: 'Av. Corrientes',
  number: '1234',
  apartment: null,
  postalCode: 'C1043AAZ',
  city: 'CABA',
  province: 'CABA',
} as const

/** Fila de `orders` con un mate suelto y un kit (piezas guardadas en desorden). */
function row(overrides: Partial<OrderRow> = {}): OrderRow {
  return {
    id: 'o1',
    number: 'GLP-10001',
    customerId: 'c1',
    status: 'expired',
    paymentStatus: 'none',
    paymentMethod: 'mp_redirect',
    contactEmail: 'ana@example.com',
    contactFirstName: 'Ana',
    contactLastName: 'Gómez',
    contactPhone: null,
    shippingMethod: 'home',
    shippingAddress: HOME,
    shippingCostArs: 6500,
    shippingEta: '3 a 5 días hábiles',
    itemsGrossArs: 155995,
    kitSavingsArs: 7600,
    subtotalArs: 148395,
    totalArs: 154895,
    kitDiscountPercent: 10,
    accessTokenHash: 'a'.repeat(64),
    reservedUntil: RESERVED_UNTIL,
    placedAt: CREATED_AT,
    paidAt: null,
    cancelledAt: null,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    items: [
      {
        id: 'i1',
        orderId: 'o1',
        lineType: 'product',
        productId: 'p-mate',
        productSlug: 'mate-imperial-premium',
        name: 'Mate Imperial Premium',
        detail: 'Cuero negro · Alpaca cincelada',
        quantity: 2,
        unitPriceArs: 39999,
        kitSavingsArs: 0,
        totalArs: 79998,
        options: { leather: 'Negro', ferrule: 'Alpaca cincelada' },
        position: 0,
        components: [],
      },
      {
        id: 'i2',
        orderId: 'o1',
        lineType: 'kit',
        productId: null,
        productSlug: null,
        name: 'Kit',
        detail: 'Mate Imperial Premium + Bombillón 100% Alpaca + Yerba Canarias 1 kg · Cuero negro',
        quantity: 1,
        unitPriceArs: 75997,
        kitSavingsArs: 7600,
        totalArs: 68397,
        options: { leather: 'Negro', ferrule: 'Alpaca cincelada' },
        position: 1,
        components: [
          {
            orderItemId: 'i2',
            role: 'yerba',
            productId: 'p-yerba',
            slug: 'yerba',
            name: 'Yerba',
            unitPriceArs: 9999,
          },
          {
            orderItemId: 'i2',
            role: 'mate',
            productId: 'p-mate',
            slug: 'mate',
            name: 'Mate',
            unitPriceArs: 39999,
          },
          {
            orderItemId: 'i2',
            role: 'bombilla',
            productId: 'p-bombilla',
            slug: 'bombilla',
            name: 'Bombilla',
            unitPriceArs: 25999,
          },
        ],
      },
    ],
    history: [
      {
        id: 'h1',
        orderId: 'o1',
        fromStatus: null,
        toStatus: 'pending_payment',
        actor: 'customer',
        note: null,
        createdAt: CREATED_AT,
      },
      {
        id: 'h2',
        orderId: 'o1',
        fromStatus: 'pending_payment',
        toStatus: 'expired',
        actor: 'system',
        note: null,
        createdAt: RESERVED_UNTIL,
      },
    ],
    shipment: null,
    payments: [],
    ...overrides,
  }
}

describe('order.mapper', () => {
  it('convierte la fila en el pedido del dominio', () => {
    const order = toOrder(row())

    expect(order).toMatchObject({
      id: 'o1',
      number: 'GLP-10001',
      customerId: 'c1',
      status: 'expired',
      paymentStatus: 'none',
      paymentMethod: 'mp_redirect',
      contact: { email: 'ana@example.com', firstName: 'Ana', lastName: 'Gómez', phone: null },
      shipping: { method: 'home', address: HOME, costArs: 6500, eta: '3 a 5 días hábiles' },
      totalArs: 154895,
      createdAt: CREATED_AT,
      reservedUntil: RESERVED_UNTIL,
      tracking: null,
      payment: null,
    })
    expect(order.history).toEqual([
      { status: 'pending_payment', at: CREATED_AT, note: null },
      { status: 'expired', at: RESERVED_UNTIL, note: null },
    ])
    expect(order.lines[0]).toEqual({
      type: 'product',
      name: 'Mate Imperial Premium',
      detail: 'Cuero negro · Alpaca cincelada',
      quantity: 2,
      unitPriceArs: 39999,
      kitSavingsArs: 0,
      totalArs: 79998,
      productId: 'p-mate',
      productSlug: 'mate-imperial-premium',
      options: { leather: 'Negro', ferrule: 'Alpaca cincelada' },
      kitItems: null,
    })
  })

  it('ordena las piezas del kit como mate, bombilla y yerba', () => {
    const kit = toOrder(row()).lines[1]

    expect(kit?.kitItems?.map((piece) => [piece.role, piece.productId])).toEqual([
      ['mate', 'p-mate'],
      ['bombilla', 'p-bombilla'],
      ['yerba', 'p-yerba'],
    ])
  })

  it('arma el despacho desde shipments', () => {
    const order = toOrder(row({ shipment: { carrier: 'Andreani', trackingNumber: 'AND123' } }))

    expect(order.tracking).toEqual({ carrier: 'Andreani', number: 'AND123' })
  })

  it('arma el pago con el último intento de payments', () => {
    const order = toOrder(
      row({
        payments: [
          {
            method: 'card',
            status: 'action_required',
            installments: 3,
            paymentTypeId: 'credit_card',
            cardLastFour: '3704',
            statusDetail: 'pending_challenge',
            providerPaymentId: '1234567890',
            challengeUrl: 'https://www.mercadopago.com.ar/3ds/challenge?id=abc123',
          },
        ],
      }),
    )

    expect(order.payment).toEqual({
      method: 'card',
      status: 'action_required',
      installments: 3,
      paymentTypeId: 'credit_card',
      lastFour: '3704',
      statusDetail: 'pending_challenge',
      providerPaymentId: '1234567890',
      challengeUrl: 'https://www.mercadopago.com.ar/3ds/challenge?id=abc123',
    })
  })

  it('lee los destinos de domicilio, de sucursal y el retiro', () => {
    expect(toShippingAddress(HOME)).toEqual(HOME)
    expect(
      toShippingAddress({ postalCode: 'X5000', city: 'Córdoba', province: 'Córdoba' }),
    ).toEqual({
      postalCode: 'X5000',
      city: 'Córdoba',
      province: 'Córdoba',
    })
    expect(toShippingAddress(null)).toBeNull()
  })

  it('rechaza un destino guardado que no es válido', () => {
    expect(() =>
      toShippingAddress({ postalCode: 'X5000', city: 'Córdoba', province: 'Narnia' }),
    ).toThrow('La dirección de envío guardada en el pedido no es válida')
    expect(() => toShippingAddress({ ...HOME, number: 12 })).toThrow(TypeError)
    expect(() => toShippingAddress(['CABA'])).toThrow(TypeError)
  })

  it('lee y valida las opciones de una línea', () => {
    expect(toCartItemOptions(null)).toBeNull()
    expect(toCartItemOptions({ leather: 'Crudo', ferrule: 'Acero' })).toEqual({
      leather: 'Crudo',
      ferrule: 'Acero',
    })
    expect(() => toCartItemOptions({ leather: 'Verde', ferrule: 'Acero' })).toThrow(
      'Las opciones guardadas en la línea del pedido no son válidas',
    )
  })

  it('escribe null de la base para el retiro y las líneas sin opciones', () => {
    expect(shippingAddressJson(null)).toBe(Prisma.DbNull)
    expect(cartItemOptionsJson(null)).toBe(Prisma.DbNull)
    expect(shippingAddressJson(HOME)).toEqual(HOME)
    expect(cartItemOptionsJson({ leather: 'Negro', ferrule: 'Acero' })).toEqual({
      leather: 'Negro',
      ferrule: 'Acero',
    })
  })
})
