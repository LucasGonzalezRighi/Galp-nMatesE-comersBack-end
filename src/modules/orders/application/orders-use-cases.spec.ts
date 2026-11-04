import { describe, expect, it, vi } from 'vitest'

import { FixedClock, FIXED_NOW } from '../../../../test/support/clock'
import {
  COMBOS,
  FixedStoreSettings,
  InMemoryCustomerDirectory,
  InMemoryOrderRepository,
  InMemoryProductCatalog,
  InMemoryStock,
  PRODUCTS,
  RecordingExpirationScheduler,
} from '../../../../test/support/orders'
import { FixedSecrets } from '../../../../test/support/session'
import type { ComboCartItem, KitCartItem, ProductCartItem } from '../domain/cart-line'
import {
  CartValidationError,
  OrderConflictError,
  OrderNotFoundError,
} from '../domain/orders-errors'
import { CreateOrderCommand, type CreateOrderInput } from './commands/create-order.command'
import { ExpireOrdersCommand } from './commands/expire-orders.command'
import type { OrderExpirationSchedulerPort } from './ports/order-expiration.port'
import { GetMyOrderQuery } from './queries/get-my-order.query'
import { GetOrderQuery } from './queries/get-order.query'
import { ListMyOrdersQuery } from './queries/list-my-orders.query'
import { QuoteCartQuery } from './queries/quote-cart.query'
import { QuoteShippingQuery } from './queries/quote-shipping.query'

const MINUTE = 60_000
const RESERVATION_MS = 30 * MINUTE
const GUEST = { customerId: null }
const { imperialPremium, coquito, bombillon100, bombillonCurvo, yerbaCanarias } = PRODUCTS
const CONFLICT_DETAIL = 'El pedido cambió desde que armaste el resumen. Revisalo antes de pagar.'

const MATE: ProductCartItem = {
  type: 'product',
  productId: imperialPremium.id,
  quantity: 1,
  options: { leather: 'Negro' },
}

function setup() {
  const clock = new FixedClock()
  const stock = new InMemoryStock()
  const catalog = new InMemoryProductCatalog(stock)
  const settings = new FixedStoreSettings()
  const orders = new InMemoryOrderRepository(stock)
  const customers = new InMemoryCustomerDirectory()
  const scheduler = new RecordingExpirationScheduler()
  const secrets = new FixedSecrets()
  const expire = new ExpireOrdersCommand(orders, clock)
  return {
    clock,
    stock,
    catalog,
    settings,
    orders,
    customers,
    scheduler,
    secrets,
    expire,
    createOrder: new CreateOrderCommand(
      catalog,
      settings,
      orders,
      customers,
      secrets,
      clock,
      scheduler,
      expire,
    ),
    quoteCart: new QuoteCartQuery(catalog, settings, expire),
    quoteShipping: new QuoteShippingQuery(settings),
    getOrder: new GetOrderQuery(orders, secrets, expire),
    listMyOrders: new ListMyOrdersQuery(orders, expire),
    getMyOrder: new GetMyOrderQuery(orders, expire),
  }
}

function orderInput(changes: Partial<CreateOrderInput> = {}): CreateOrderInput {
  return {
    customer: {
      email: 'lucia@ejemplo.com',
      firstName: 'Lucía',
      lastName: 'Pérez',
      phone: '1123456789',
    },
    shipping: {
      method: 'home',
      address: {
        street: 'Av. Corrientes',
        number: '1234',
        apartment: '5° B',
        postalCode: 'C1043',
        city: 'CABA',
        province: 'CABA',
      },
    },
    items: [MATE],
    paymentMethod: 'mp_redirect',
    expectedTotalArs: 46499,
    website: null,
    ...changes,
  }
}

const DUO: ComboCartItem = {
  type: 'combo',
  comboId: COMBOS.duoImperial.id,
  quantity: 1,
  options: { leather: 'Marrón' },
}

const KIT: KitCartItem = {
  type: 'kit',
  mateId: imperialPremium.id,
  bombillaId: bombillon100.id,
  yerbaId: yerbaCanarias.id,
  leather: 'Negro',
  quantity: 1,
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error('Se esperaba un error')
}

describe('CreateOrderCommand', () => {
  it('crea el pedido en pending_payment con la reserva de 30 minutos, el token y el evento', async () => {
    const t = setup()
    const result = await t.createOrder.execute(orderInput(), GUEST)
    const [saved] = t.orders.orders
    const reservedUntil = new Date(FIXED_NOW.getTime() + RESERVATION_MS)

    expect(result.order).toEqual({
      number: 'GLP-10001',
      status: 'pending_payment',
      paymentStatus: 'none',
      customer: {
        email: 'lucia@ejemplo.com',
        firstName: 'Lucía',
        lastName: 'Pérez',
        phone: '1123456789',
      },
      shipping: {
        method: 'home',
        address: {
          street: 'Av. Corrientes',
          number: '1234',
          apartment: '5° B',
          postalCode: 'C1043',
          city: 'CABA',
          province: 'CABA',
        },
        costArs: 6500,
        eta: '3 a 6 días hábiles',
      },
      lines: [
        {
          type: 'product',
          name: 'Mate Imperial Premium',
          detail: 'Cuero negro',
          quantity: 1,
          unitPriceArs: 39999,
          kitSavingsArs: 0,
          totalArs: 39999,
          productSlug: 'mate-imperial-premium',
          options: { leather: 'Negro' },
          kitItems: null,
        },
      ],
      itemsGrossArs: 39999,
      kitSavingsArs: 0,
      subtotalArs: 39999,
      shippingArs: 6500,
      totalArs: 46499,
      payment: {
        method: 'mp_redirect',
        installments: null,
        paymentTypeId: null,
        lastFour: null,
        statusDetail: null,
        mpPaymentId: null,
        challenge: null,
      },
      tracking: null,
      history: [{ status: 'pending_payment', at: FIXED_NOW.toISOString(), note: null }],
      reservedUntil: reservedUntil.toISOString(),
      createdAt: FIXED_NOW.toISOString(),
    })
    expect(result.orderToken).toMatch(/^ot_[0-9a-f]{64}$/)
    expect(saved?.accessTokenHash).toBe(t.secrets.sha256(result.orderToken))
    expect(t.orders.drafts[0]).toMatchObject({ kitDiscountPercent: 10, number: null })
    expect(t.stock.reserved(imperialPremium.id)).toBe(1)
    expect(t.orders.events).toEqual([
      {
        type: 'order.created',
        aggregateType: 'order',
        aggregateId: 'GLP-10001',
        payload: {
          orderId: saved?.id,
          number: 'GLP-10001',
          customerId: saved?.customerId,
          totalArs: 46499,
          reservedUntil: reservedUntil.toISOString(),
        },
      },
      {
        type: 'storefront.stale',
        aggregateType: 'storefront',
        aggregateId: 'order.created',
        payload: { reason: 'order.created', tags: ['products', 'combos'] },
      },
    ])
    expect(t.scheduler.scheduled).toEqual([{ orderId: saved?.id, at: reservedUntil }])
  })

  it('copia la dirección según el método: null en el retiro', async () => {
    const t = setup()
    const result = await t.createOrder.execute(
      orderInput({
        shipping: { method: 'pickup', address: null },
        expectedTotalArs: 39999,
        paymentMethod: 'card',
      }),
      GUEST,
    )

    expect(result.order.shipping).toEqual({
      method: 'pickup',
      address: null,
      costArs: 0,
      eta: 'Coordinamos por mail',
    })
    expect(result.order.payment.method).toBe('card')
  })

  it('responde 409 stock_changed con los avisos de la cotización y no crea nada', async () => {
    const t = setup()
    const items = [
      {
        type: 'product' as const,
        productId: coquito.id,
        quantity: 3,
        options: { leather: 'Negro' as const },
        expectedUnitPriceArs: 1,
      },
    ]
    const error = await rejection(
      t.createOrder.execute(orderInput({ items, expectedTotalArs: 1 }), GUEST),
    )

    expect(error).toBeInstanceOf(OrderConflictError)
    expect(error).toMatchObject({
      status: 409,
      code: 'stock_changed',
      title: 'El stock cambió',
      detail: CONFLICT_DETAIL,
      changes: [
        {
          kind: 'stock',
          productId: coquito.id,
          message: 'Quedan 2 unidades de Mate Coquito Criollo.',
        },
      ],
    })
    expect(t.orders.drafts).toEqual([])
    expect(t.customers.customers).toEqual([])
  })

  it('responde 409 stock_changed con los avisos del repositorio si otro pedido reservó antes', async () => {
    const t = setup()
    t.stock.set(imperialPremium.id, 1)
    const results = await Promise.allSettled([
      t.createOrder.execute(orderInput(), GUEST),
      t.createOrder.execute(orderInput(), GUEST),
    ])

    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected'])
    expect(results[1]).toMatchObject({
      reason: {
        code: 'stock_changed',
        changes: [
          {
            kind: 'stock',
            productId: imperialPremium.id,
            message: 'Mate Imperial Premium se agotó.',
          },
        ],
      },
    })
    expect(t.orders.drafts).toHaveLength(2)
    expect(t.orders.orders).toHaveLength(1)
    expect(t.scheduler.scheduled).toHaveLength(1)
  })

  it('sin sobreventa: con 5 disponibles, 10 pedidos simultáneos dejan 5 pedidos y 5 avisos', async () => {
    const t = setup()
    t.stock.set(imperialPremium.id, 5)
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => t.createOrder.execute(orderInput(), GUEST)),
    )
    const rejected = results.filter((result) => result.status === 'rejected')

    expect(t.orders.orders.map((order) => order.status)).toEqual(
      Array.from({ length: 5 }, () => 'pending_payment'),
    )
    expect(t.stock.reserved(imperialPremium.id)).toBe(5)
    expect(rejected).toHaveLength(5)
    for (const result of rejected) {
      expect(result.reason).toMatchObject({
        status: 409,
        code: 'stock_changed',
        changes: [{ message: 'Mate Imperial Premium se agotó.' }],
      })
    }
  })

  it('el mismo producto suelto y dentro de un kit comparte el stock', async () => {
    const t = setup()
    t.stock.set(imperialPremium.id, 1)
    await t.createOrder.execute(orderInput(), GUEST)
    const error = await rejection(
      t.createOrder.execute(orderInput({ items: [KIT], expectedTotalArs: 74897 }), GUEST),
    )

    expect(error).toMatchObject({
      code: 'stock_changed',
      changes: [
        {
          kind: 'stock',
          productId: imperialPremium.id,
          message: 'Mate Imperial Premium se agotó.',
        },
      ],
    })
  })

  it('un combo reserva cada pieza y guarda sus piezas en el orden del combo', async () => {
    const t = setup()
    const result = await t.createOrder.execute(
      orderInput({ items: [DUO], expectedTotalArs: 68499 }),
      GUEST,
    )

    expect(result.order.lines).toEqual([
      {
        type: 'combo',
        name: 'Dúo Imperial',
        detail: 'Mate Imperial Premium + Bombillón Premium Curvo · Cuero marrón',
        quantity: 1,
        unitPriceArs: 68998,
        kitSavingsArs: 6999,
        totalArs: 61999,
        productSlug: null,
        options: { leather: 'Marrón' },
        kitItems: [
          { slug: 'mate-imperial-premium', name: 'Mate Imperial Premium', unitPriceArs: 39999 },
          { slug: 'bombillon-premium-curvo', name: 'Bombillón Premium Curvo', unitPriceArs: 28999 },
        ],
      },
    ])
    expect(result.order).toMatchObject({ kitSavingsArs: 6999, subtotalArs: 61999 })
    expect(t.stock.reserved(imperialPremium.id)).toBe(1)
    expect(t.stock.reserved(bombillonCurvo.id)).toBe(1)
  })

  it('un combo dado de baja responde 409 stock_changed sin producto, nunca un error', async () => {
    const t = setup()
    t.catalog.updateCombo(COMBOS.duoImperial.id, { status: 'draft' })
    const error = await rejection(
      t.createOrder.execute(orderInput({ items: [DUO], expectedTotalArs: 68499 }), GUEST),
    )

    expect(error).toMatchObject({
      status: 409,
      code: 'stock_changed',
      changes: [
        { kind: 'unavailable', productId: null, message: 'Dúo Imperial ya no está disponible.' },
      ],
    })
    expect(t.orders.orders).toEqual([])
  })

  it('responde 409 price_changed si cambió el precio que esperaba la tienda', async () => {
    const t = setup()
    const error = await rejection(
      t.createOrder.execute(
        orderInput({ items: [{ ...MATE, expectedUnitPriceArs: 35999 }] }),
        GUEST,
      ),
    )

    expect(error).toMatchObject({
      status: 409,
      code: 'price_changed',
      title: 'Cambiaron los precios',
      detail: CONFLICT_DETAIL,
      changes: [
        {
          kind: 'price',
          productId: imperialPremium.id,
          message: 'Mate Imperial Premium cambió de precio: ahora cuesta $39.999.',
        },
      ],
    })
  })

  it('responde 409 total_changed si el total no es el que vio la persona', async () => {
    const t = setup()
    t.catalog.update(imperialPremium.id, { priceArs: 42999 })
    const error = await rejection(t.createOrder.execute(orderInput(), GUEST))

    expect(error).toMatchObject({
      status: 409,
      code: 'total_changed',
      title: 'El total cambió',
      detail: CONFLICT_DETAIL,
      changes: [
        { kind: 'price', productId: null, message: 'El total cambió de $46.499 a $49.499.' },
      ],
    })
    expect(t.orders.drafts).toEqual([])
  })

  it('precio gana al total', async () => {
    const t = setup()
    t.catalog.update(imperialPremium.id, { priceArs: 42999 })
    const error = await rejection(
      t.createOrder.execute(
        orderInput({ items: [{ ...MATE, expectedUnitPriceArs: 39999 }] }),
        GUEST,
      ),
    )

    expect(error).toMatchObject({ code: 'price_changed' })
  })

  it('responde 422 en shipping.method si el envío está deshabilitado', async () => {
    const t = setup()
    t.settings.setEnabled('home', false)
    const error = await rejection(t.createOrder.execute(orderInput(), GUEST))

    expect(error).toBeInstanceOf(CartValidationError)
    expect(error).toMatchObject({
      status: 422,
      errors: [
        {
          field: 'shipping.method',
          code: 'unavailable',
          message: 'Ese método de envío no está disponible.',
        },
      ],
    })
  })

  it('responde 422 en items.{i}.options si un mate llega sin opciones', async () => {
    const t = setup()
    const items = [
      { type: 'product' as const, productId: imperialPremium.id, quantity: 1, options: null },
    ]
    const error = await rejection(t.createOrder.execute(orderInput({ items }), GUEST))

    expect(error).toMatchObject({
      status: 422,
      errors: [{ field: 'items.0.options', code: 'required' }],
    })
  })

  it('con el honeypot lleno responde un pedido inventado sin guardar ni reservar nada', async () => {
    const t = setup()
    const result = await t.createOrder.execute(
      orderInput({ website: 'https://spam.example' }),
      GUEST,
    )

    expect(result.order).toMatchObject({
      number: 'GLP-00000',
      status: 'pending_payment',
      totalArs: 46499,
    })
    expect(result.orderToken).toMatch(/^ot_[0-9a-f]{64}$/)
    expect(t.orders.drafts).toEqual([])
    expect(t.orders.events).toEqual([])
    expect(t.scheduler.scheduled).toEqual([])
    expect(t.customers.customers).toEqual([])
    expect(t.stock.reserved(imperialPremium.id)).toBe(0)
  })

  it('con sesión, el pedido es del cliente de la sesión aunque el email sea de otro', async () => {
    const t = setup()
    t.customers.add({
      userId: 'usr-otro',
      email: 'lucia@ejemplo.com',
      firstName: 'Otra',
      lastName: 'Persona',
      phone: null,
    })
    await t.createOrder.execute(orderInput(), { customerId: 'cus-sesion' })

    expect(t.orders.orders[0]?.customerId).toBe('cus-sesion')
    expect(t.customers.customers).toHaveLength(1)
    expect(t.customers.customers[0]?.firstName).toBe('Otra')
  })

  it('sin sesión crea el invitado con el email normalizado y lo vincula', async () => {
    const t = setup()
    const input = orderInput()
    await t.createOrder.execute(
      { ...input, customer: { ...input.customer, email: '  Lucia@Ejemplo.COM ' } },
      GUEST,
    )

    expect(t.customers.customers).toEqual([
      {
        id: t.orders.orders[0]?.customerId,
        userId: null,
        email: 'lucia@ejemplo.com',
        firstName: 'Lucía',
        lastName: 'Pérez',
        phone: '1123456789',
      },
    ])
    expect(t.orders.orders[0]?.contact.email).toBe('lucia@ejemplo.com')
  })

  it('sin sesión vincula al invitado que ya existía y le actualiza nombre y teléfono', async () => {
    const t = setup()
    const guest = t.customers.add({
      userId: null,
      email: 'lucia@ejemplo.com',
      firstName: 'Lu',
      lastName: 'P',
      phone: null,
    })
    await t.createOrder.execute(orderInput(), GUEST)

    expect(t.orders.orders[0]?.customerId).toBe(guest.id)
    expect(t.customers.customers).toEqual([
      { ...guest, firstName: 'Lucía', lastName: 'Pérez', phone: '1123456789' },
    ])
  })

  it('sin sesión, con el email de una cuenta, el pedido queda sin dueño (solo por token)', async () => {
    const t = setup()
    const account = t.customers.add({
      userId: 'usr-1',
      email: 'lucia@ejemplo.com',
      firstName: 'Lucía',
      lastName: 'Pérez',
      phone: null,
    })
    await t.createOrder.execute(orderInput(), GUEST)

    expect(t.orders.orders[0]?.customerId).toBeNull()
    expect(t.customers.customers).toEqual([account])
  })

  it('si programar el vencimiento falla, el pedido ya guardado se devuelve igual', async () => {
    const t = setup()
    const scheduler: OrderExpirationSchedulerPort = {
      schedule: () => Promise.reject(new Error('Redis caído')),
    }
    const createOrder = new CreateOrderCommand(
      t.catalog,
      t.settings,
      t.orders,
      t.customers,
      t.secrets,
      t.clock,
      scheduler,
      t.expire,
    )

    const result = await createOrder.execute(orderInput(), GUEST)

    expect(result.order).toMatchObject({ number: 'GLP-10001', status: 'pending_payment' })
    expect(t.orders.orders).toHaveLength(1)
    expect(t.stock.reserved(imperialPremium.id)).toBe(1)
    t.clock.advance(RESERVATION_MS)
    expect(await t.expire.expireDue()).toEqual({ expired: 1, failed: [] })
  })

  it('vence primero los pedidos atrasados, así su stock vuelve a estar disponible', async () => {
    const t = setup()
    t.stock.set(imperialPremium.id, 1)
    await t.createOrder.execute(orderInput(), GUEST)
    t.clock.advance(RESERVATION_MS)
    const second = await t.createOrder.execute(orderInput(), GUEST)

    expect(second.order.number).toBe('GLP-10002')
    expect(t.orders.orders[0]?.status).toBe('expired')
    expect(t.stock.reserved(imperialPremium.id)).toBe(1)
  })
})

describe('GetOrderQuery', () => {
  async function created() {
    const t = setup()
    const result = await t.createOrder.execute(orderInput(), { customerId: 'cus-1' })
    return { t, result }
  }

  it('devuelve el pedido con el token correcto', async () => {
    const { t, result } = await created()
    const order = await t.getOrder.execute('GLP-10001', {
      token: result.orderToken,
      customerId: null,
    })

    expect(order).toEqual(result.order)
  })

  it('devuelve el pedido a la sesión dueña sin token (o con un token ajeno)', async () => {
    const { t } = await created()

    await expect(
      t.getOrder.execute('GLP-10001', { token: null, customerId: 'cus-1' }),
    ).resolves.toMatchObject({ number: 'GLP-10001' })
    await expect(
      t.getOrder.execute('GLP-10001', { token: 'ot_ajeno', customerId: 'cus-1' }),
    ).resolves.toMatchObject({ number: 'GLP-10001' })
  })

  it('responde 404 con un token ajeno, una sesión ajena o un número que no existe', async () => {
    const { t, result } = await created()

    for (const [number, access] of [
      ['GLP-10001', { token: 'ot_ajeno', customerId: null }],
      ['GLP-10001', { token: null, customerId: 'cus-2' }],
      ['GLP-10001', { token: null, customerId: null }],
      ['GLP-10002', { token: result.orderToken, customerId: 'cus-1' }],
    ] as const) {
      const error = await rejection(t.getOrder.execute(number, access))
      expect(error).toBeInstanceOf(OrderNotFoundError)
      expect(error).toMatchObject({
        status: 404,
        code: 'not_found',
        detail: 'No encontramos ese pedido.',
      })
    }
  })

  it('vence el pedido al leerlo si pasó reservedUntil', async () => {
    const { t, result } = await created()
    t.clock.advance(RESERVATION_MS + 5 * MINUTE)
    const order = await t.getOrder.execute('GLP-10001', {
      token: result.orderToken,
      customerId: null,
    })

    expect(order.status).toBe('expired')
    expect(order.history).toEqual([
      { status: 'pending_payment', at: FIXED_NOW.toISOString(), note: null },
      { status: 'expired', at: result.order.reservedUntil, note: null },
    ])
    expect(t.stock.reserved(imperialPremium.id)).toBe(0)
    expect(t.orders.events.map((event) => [event.type, event.aggregateId])).toEqual([
      ['order.created', 'GLP-10001'],
      ['storefront.stale', 'order.created'],
      ['order.expired', 'GLP-10001'],
      ['storefront.stale', 'order.expired'],
    ])
  })
})

describe('ListMyOrdersQuery y GetMyOrderQuery', () => {
  it('lista del más nuevo al más viejo (a igual fecha, número desc), de a 10', async () => {
    const t = setup()
    t.stock.set(imperialPremium.id, 20)
    for (let index = 0; index < 12; index += 1) {
      await t.createOrder.execute(orderInput(), { customerId: 'cus-1' })
      if (index < 10) t.clock.advance(MINUTE)
    }
    await t.createOrder.execute(orderInput(), { customerId: 'cus-2' })

    const first = await t.listMyOrders.execute('cus-1', 1)
    const second = await t.listMyOrders.execute('cus-1', 2)
    const outside = await t.listMyOrders.execute('cus-1', 3)

    expect(first.items.map((order) => order.number)).toEqual([
      'GLP-10012',
      'GLP-10011',
      'GLP-10010',
      'GLP-10009',
      'GLP-10008',
      'GLP-10007',
      'GLP-10006',
      'GLP-10005',
      'GLP-10004',
      'GLP-10003',
    ])
    expect(first).toMatchObject({ page: 1, pageSize: 10, total: 12 })
    expect(second.items.map((order) => order.number)).toEqual(['GLP-10002', 'GLP-10001'])
    expect(outside).toEqual({ items: [], page: 3, pageSize: 10, total: 12 })
    expect(first.items[0]).toEqual({
      number: 'GLP-10012',
      createdAt: new Date(FIXED_NOW.getTime() + 10 * MINUTE).toISOString(),
      status: 'pending_payment',
      paymentStatus: 'none',
      totalArs: 46499,
      itemCount: 1,
    })
    await expect(t.listMyOrders.execute('cus-1', 0)).rejects.toThrow(RangeError)
  })

  it('cuenta las unidades (un kit cuenta como una) y vence los pedidos antes de listar', async () => {
    const t = setup()
    await t.createOrder.execute(
      orderInput({
        items: [{ ...KIT, quantity: 2 }, MATE],
        expectedTotalArs: 2 * 68397 + 39999 + 6500,
      }),
      { customerId: 'cus-1' },
    )
    t.clock.advance(RESERVATION_MS)
    const page = await t.listMyOrders.execute('cus-1', 1)

    expect(page.items[0]).toMatchObject({ itemCount: 3, status: 'expired' })
  })

  it('devuelve el pedido propio, vencido si corresponde, y 404 si es de otro', async () => {
    const t = setup()
    await t.createOrder.execute(orderInput(), { customerId: 'cus-1' })

    await expect(t.getMyOrder.execute('cus-1', 'GLP-10001')).resolves.toMatchObject({
      number: 'GLP-10001',
      status: 'pending_payment',
    })
    await expect(t.getMyOrder.execute('cus-2', 'GLP-10001')).rejects.toBeInstanceOf(
      OrderNotFoundError,
    )
    await expect(t.getMyOrder.execute('cus-1', 'GLP-10002')).rejects.toBeInstanceOf(
      OrderNotFoundError,
    )
    t.clock.advance(RESERVATION_MS)
    await expect(t.getMyOrder.execute('cus-1', 'GLP-10001')).resolves.toMatchObject({
      status: 'expired',
    })
  })
})

describe('ExpireOrdersCommand', () => {
  it('es idempotente: vence y libera una sola vez', async () => {
    const t = setup()
    await t.createOrder.execute(orderInput(), GUEST)
    const id = t.orders.orders[0]?.id ?? ''

    expect(await t.expire.expireOne(id)).toBeNull()
    t.clock.advance(RESERVATION_MS)
    expect(await t.expire.expireOne(id)).toMatchObject({ status: 'expired' })
    expect(await t.expire.expireOne(id)).toBeNull()
    expect(await t.expire.expireDue()).toEqual({ expired: 0, failed: [] })
    expect(t.orders.expirations).toBe(1)
    expect(t.stock.reserved(imperialPremium.id)).toBe(0)
    expect(t.orders.events.slice(-2)).toEqual([
      {
        type: 'order.expired',
        aggregateType: 'order',
        aggregateId: 'GLP-10001',
        payload: { orderId: id, number: 'GLP-10001' },
      },
      {
        type: 'storefront.stale',
        aggregateType: 'storefront',
        aggregateId: 'order.expired',
        payload: { reason: 'order.expired', tags: ['products', 'combos'] },
      },
    ])
  })

  it('vence los atrasados de a tandas y devuelve cuántos venció', async () => {
    const t = setup()
    await t.createOrder.execute(orderInput(), GUEST)
    await t.createOrder.execute(orderInput(), GUEST)
    t.clock.advance(RESERVATION_MS)

    expect(await t.expire.expireDue(1)).toEqual({ expired: 1, failed: [] })
    expect(await t.expire.expireDue()).toEqual({ expired: 1, failed: [] })
    expect(await t.expire.expireDue()).toEqual({ expired: 0, failed: [] })
    await expect(t.expire.expireDue(0)).rejects.toThrow(RangeError)
  })

  it('si vencer un pedido falla, sigue con los demás, lo devuelve en failed y no rompe la cotización', async () => {
    const t = setup()
    await t.createOrder.execute(orderInput(), GUEST)
    await t.createOrder.execute(orderInput(), GUEST)
    await t.createOrder.execute(orderInput(), GUEST)
    const [broken] = t.orders.orders
    const failure = new Error('deadlock detected')
    const realExpire = t.orders.expire.bind(t.orders)
    vi.spyOn(t.orders, 'expire').mockImplementation((orderId, now, events) =>
      orderId === broken?.id ? Promise.reject(failure) : realExpire(orderId, now, events),
    )
    t.clock.advance(RESERVATION_MS)

    expect(await t.expire.expireDue()).toEqual({
      expired: 2,
      failed: [{ orderId: broken?.id, number: 'GLP-10001', error: failure }],
    })
    expect(t.orders.orders.map((order) => order.status)).toEqual([
      'pending_payment',
      'expired',
      'expired',
    ])
    expect(t.stock.reserved(imperialPremium.id)).toBe(1)
    const quote = await t.quoteCart.execute(orderInput().items)
    expect(quote.lines[0]).toMatchObject({ issue: null, maxQuantity: 11 })
    const page = await t.listMyOrders.execute('cus-1', 1)
    expect(page.items.map((order) => order.status)).toEqual([
      'expired',
      'expired',
      'pending_payment',
    ])
  })

  it('no vence un pedido con un pago en curso', async () => {
    const t = setup()
    await t.createOrder.execute(orderInput(), GUEST)
    t.orders.update('GLP-10001', { paymentStatus: 'pending' })
    t.clock.advance(RESERVATION_MS)

    expect(await t.expire.expireDue()).toEqual({ expired: 0, failed: [] })
    const order = await t.orders.findByNumber('GLP-10001')
    expect(order === null ? null : await t.expire.expireIfDue(order)).toMatchObject({
      status: 'pending_payment',
    })
  })
})

describe('QuoteCartQuery', () => {
  it('cotiza el carrito con el stock que liberan los pedidos vencidos', async () => {
    const t = setup()
    t.stock.set(imperialPremium.id, 1)
    await t.createOrder.execute(orderInput(), GUEST)

    expect((await t.quoteCart.execute(orderInput().items)).lines[0]?.issue).toBe('sold_out')
    t.clock.advance(RESERVATION_MS)
    const quote = await t.quoteCart.execute(orderInput().items)
    expect(quote).toMatchObject({ subtotalArs: 39999, netSubtotalArs: 33057 })
    expect(quote.lines[0]).toMatchObject({ issue: null, maxQuantity: 1 })
  })

  it('responde 422 si un mate llega sin opciones', async () => {
    const t = setup()
    const items = [
      { type: 'product' as const, productId: imperialPremium.id, quantity: 1, options: null },
    ]

    await expect(t.quoteCart.execute(items)).rejects.toBeInstanceOf(CartValidationError)
  })

  it('carga los combos y busca las piezas junto con los productos de las demás líneas', async () => {
    const t = setup()
    const quote = await t.quoteCart.execute([MATE, DUO])

    expect(t.catalog.calls).toEqual([[imperialPremium.id, bombillonCurvo.id]])
    expect(quote.lines.map((line) => [line.type, line.totalArs])).toEqual([
      ['product', 39999],
      ['combo', 61999],
    ])
  })

  it('un combo con mate sin opciones responde 422', async () => {
    const t = setup()

    await expect(t.quoteCart.execute([{ ...DUO, options: null }])).rejects.toMatchObject({
      errors: [{ field: 'items.0.options', code: 'required' }],
    })
  })
})

describe('QuoteShippingQuery', () => {
  const items = orderInput().items

  it('devuelve el costo y el plazo del método', async () => {
    const t = setup()

    await expect(
      t.quoteShipping.execute({ method: 'pickup', postalCode: null, items }),
    ).resolves.toEqual({ method: 'pickup', costArs: 0, eta: 'Coordinamos por mail' })
    await expect(
      t.quoteShipping.execute({ method: 'home', postalCode: 'C1043', items }),
    ).resolves.toEqual({ method: 'home', costArs: 6500, eta: '3 a 6 días hábiles' })
  })

  it('pide el código postal salvo en el retiro', async () => {
    const t = setup()

    await expect(
      t.quoteShipping.execute({ method: 'home', postalCode: null, items }),
    ).rejects.toMatchObject({
      status: 422,
      errors: [{ field: 'postalCode', code: 'required', message: 'Ingresá el código postal.' }],
    })
  })

  it('responde 422 en method si el envío está deshabilitado', async () => {
    const t = setup()
    t.settings.setEnabled('branch', false)

    await expect(
      t.quoteShipping.execute({ method: 'branch', postalCode: 'X5000', items }),
    ).rejects.toMatchObject({
      status: 422,
      errors: [{ field: 'method', code: 'unavailable' }],
    })
  })
})
