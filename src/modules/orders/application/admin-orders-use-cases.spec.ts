import { describe, expect, it, vi } from 'vitest'

import { FixedClock } from '../../../../test/support/clock'
import {
  FixedStoreSettings,
  InMemoryAdminOrderRepository,
  InMemoryCustomerDirectory,
  InMemoryOrderRepository,
  InMemoryProductCatalog,
  InMemoryStock,
  PRODUCTS,
  RecordingExpirationScheduler,
} from '../../../../test/support/orders'
import { FixedSecrets } from '../../../../test/support/session'
import type { OrderPaymentInfo } from '../domain/order.entity'
import {
  AdminOrderNotFoundError,
  InvalidStatusTransitionError,
  PaymentInProgressError,
} from '../domain/orders-errors'
import {
  ChangeOrderStatusCommand,
  type OrderStatusChangeInput,
} from './commands/change-order-status.command'
import { CreateOrderCommand, type CreateOrderInput } from './commands/create-order.command'
import { ExpireOrdersCommand } from './commands/expire-orders.command'
import { GetAdminOrderQuery } from './queries/get-admin-order.query'
import {
  ADMIN_ORDERS_PAGE_SIZE,
  type AdminOrderListInput,
  ListAdminOrdersQuery,
} from './queries/list-admin-orders.query'

const MINUTE = 60_000
const { imperialPremium } = PRODUCTS

/** Intento de pago activo, todavía sin resultado (`none`). */
const OPEN_ATTEMPT: OrderPaymentInfo = {
  method: 'mp_redirect',
  status: 'none',
  installments: null,
  paymentTypeId: null,
  lastFour: null,
  statusDetail: null,
  providerPaymentId: null,
  challengeUrl: null,
}

function setup() {
  const clock = new FixedClock()
  const stock = new InMemoryStock()
  const catalog = new InMemoryProductCatalog(stock)
  stock.set(imperialPremium.id, 50)
  const orders = new InMemoryOrderRepository(stock)
  const adminOrders = new InMemoryAdminOrderRepository(orders, stock)
  const expire = new ExpireOrdersCommand(orders, clock)
  const createOrder = new CreateOrderCommand(
    catalog,
    new FixedStoreSettings(),
    orders,
    new InMemoryCustomerDirectory(),
    new FixedSecrets(),
    clock,
    new RecordingExpirationScheduler(),
    expire,
  )
  /** Crea un pedido por el checkout (un mate) a nombre de `firstName lastName`. */
  async function place(firstName = 'Lucía', lastName = 'Pérez', email = 'lucia@ejemplo.com') {
    const input: CreateOrderInput = {
      customer: { email, firstName, lastName, phone: null },
      shipping: { method: 'pickup', address: null },
      items: [
        {
          type: 'product',
          productId: imperialPremium.id,
          quantity: 1,
          options: { leather: 'Negro', ferrule: 'Alpaca cincelada' },
        },
      ],
      paymentMethod: 'mp_redirect',
      expectedTotalArs: imperialPremium.priceArs,
      website: null,
    }
    const { order } = await createOrder.execute(input, { customerId: null })
    return order.number
  }
  return {
    clock,
    stock,
    orders,
    adminOrders,
    place,
    list: new ListAdminOrdersQuery(adminOrders, expire),
    get: new GetAdminOrderQuery(orders, expire),
    change: new ChangeOrderStatusCommand(orders, adminOrders, expire, clock),
  }
}

type Harness = ReturnType<typeof setup>

function listInput(changes: Partial<AdminOrderListInput> = {}): AdminOrderListInput {
  return { page: 1, statuses: [], paymentStatus: null, q: null, ...changes }
}

function change(
  status: OrderStatusChangeInput['status'],
  changes: Partial<OrderStatusChangeInput> = {},
): OrderStatusChangeInput {
  return { status, carrier: null, trackingNumber: null, note: null, ...changes }
}

const SHIP = change('shipped', { carrier: 'Andreani', trackingNumber: 'AND123456789' })

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error('Se esperaba un error')
}

/** Pedido pagado (como lo deja `markPaid`). */
async function paidOrder(t: Harness): Promise<string> {
  const number = await t.place()
  t.orders.update(number, { status: 'paid', paymentStatus: 'approved' })
  return number
}

/** Eventos que dejó en el outbox lo que corre `action`. */
async function eventsOf(t: Harness, action: () => Promise<unknown>) {
  const before = t.orders.events.length
  await action()
  return t.orders.events.slice(before)
}

describe('ListAdminOrdersQuery', () => {
  it('trae los pedidos del más nuevo al más viejo, de a 20, con el total', async () => {
    const t = setup()
    for (let index = 0; index < 22; index += 1) {
      await t.place()
      t.clock.advance(1_000)
    }

    const first = await t.list.execute(listInput())
    const second = await t.list.execute(listInput({ page: 2 }))
    const outside = await t.list.execute(listInput({ page: 3 }))

    expect(ADMIN_ORDERS_PAGE_SIZE).toBe(20)
    expect(first).toMatchObject({ page: 1, pageSize: 20, total: 22 })
    expect(first.items).toHaveLength(20)
    expect(first.items[0]?.number).toBe('GLP-10022')
    expect(second.items.map((order) => order.number)).toEqual(['GLP-10002', 'GLP-10001'])
    expect(outside).toEqual({ items: [], page: 3, pageSize: 20, total: 22 })
  })

  it('combina estados, estado del pago y búsqueda sin acentos ni mayúsculas', async () => {
    const t = setup()
    const lucia = await t.place('Lucía', 'Pérez', 'lucia@ejemplo.com')
    const bruno = await t.place('Bruno', 'Díaz', 'BRUNO@ejemplo.com')
    const ana = await t.place('Ana', 'Gómez', 'ana@ejemplo.com')
    t.orders.update(lucia, { status: 'paid', paymentStatus: 'approved' })
    t.orders.update(bruno, { status: 'preparing', paymentStatus: 'approved' })

    const toShip = await t.list.execute(listInput({ statuses: ['paid', 'preparing'] }))
    const pending = await t.list.execute(listInput({ paymentStatus: 'none' }))
    const byName = await t.list.execute(listInput({ q: '  LUCIA   perez ' }))
    const byEmail = await t.list.execute(listInput({ q: 'bruno@' }))
    const byNumber = await t.list.execute(listInput({ q: ana.toLowerCase() }))
    const none = await t.list.execute(listInput({ statuses: ['paid'], q: 'bruno' }))

    expect(toShip.items.map((order) => order.number)).toEqual([bruno, lucia])
    expect(pending.items.map((order) => order.number)).toEqual([ana])
    expect(byName.items.map((order) => order.number)).toEqual([lucia])
    expect(byEmail.items.map((order) => order.number)).toEqual([bruno])
    expect(byNumber.items.map((order) => order.number)).toEqual([ana])
    expect(none).toMatchObject({ items: [], total: 0 })
  })

  it('vence antes los pedidos atrasados', async () => {
    const t = setup()
    const number = await t.place()
    t.clock.advance(31 * MINUTE)

    const page = await t.list.execute(listInput({ statuses: ['expired'] }))

    expect(page.items.map((order) => [order.number, order.status])).toEqual([[number, 'expired']])
    expect(t.orders.expirations).toBe(1)
  })

  it('valida la entrada', async () => {
    const t = setup()
    await expect(t.list.execute(listInput({ page: 0 }))).rejects.toThrow(RangeError)
    await expect(t.list.execute(listInput({ statuses: ['enviado' as 'paid'] }))).rejects.toThrow(
      'Estado de pedido desconocido',
    )
    await expect(t.list.execute(listInput({ paymentStatus: 'x' as 'none' }))).rejects.toThrow(
      'Estado de pago desconocido',
    )
  })
})

describe('GetAdminOrderQuery', () => {
  it('devuelve el pedido completo, vencido si ya correspondía', async () => {
    const t = setup()
    const number = await t.place()

    await expect(t.get.execute(number)).resolves.toMatchObject({
      number,
      status: 'pending_payment',
    })
    t.clock.advance(31 * MINUTE)
    await expect(t.get.execute(number)).resolves.toMatchObject({ number, status: 'expired' })
  })

  it('un número que no existe da 404 "No existe ese pedido."', async () => {
    const t = setup()
    const error = await rejection(t.get.execute('GLP-99999'))

    expect(error).toBeInstanceOf(AdminOrderNotFoundError)
    expect(error).toMatchObject({ status: 404, code: 'not_found', detail: 'No existe ese pedido.' })
  })
})

describe('ChangeOrderStatusCommand', () => {
  it('pagado → en preparación: historial con la nota y sin eventos', async () => {
    const t = setup()
    const number = await paidOrder(t)
    t.clock.advance(MINUTE)

    let order: Awaited<ReturnType<typeof t.change.execute>> | undefined
    const events = await eventsOf(t, async () => {
      order = await t.change.execute(number, change('preparing', { note: 'Lo arma Bruno' }))
    })

    expect(order?.status).toBe('preparing')
    expect(order?.history.at(-1)).toEqual({
      status: 'preparing',
      at: t.clock.now().toISOString(),
      note: 'Lo arma Bruno',
    })
    expect(events).toEqual([])
  })

  it('despachar guarda el seguimiento y deja order.shipped; entregar deja order.delivered', async () => {
    const t = setup()
    const number = await paidOrder(t)
    const [saved] = t.orders.orders

    const shippedEvents = await eventsOf(t, () => t.change.execute(number, SHIP))
    const delivered = await t.change.execute(number, change('delivered'))
    const deliveredEvents = t.orders.events.slice(-1)

    expect(shippedEvents).toEqual([
      {
        type: 'order.shipped',
        aggregateType: 'order',
        aggregateId: number,
        payload: {
          orderId: saved?.id,
          number,
          carrier: 'Andreani',
          trackingNumber: 'AND123456789',
        },
      },
    ])
    expect(delivered).toMatchObject({
      status: 'delivered',
      tracking: { carrier: 'Andreani', number: 'AND123456789' },
    })
    expect(deliveredEvents).toEqual([
      {
        type: 'order.delivered',
        aggregateType: 'order',
        aggregateId: number,
        payload: { orderId: saved?.id, number },
      },
    ])
  })

  it('cancelar con un intento activo lo cancela, libera la reserva y avisa a la tienda', async () => {
    const t = setup()
    const number = await t.place()
    t.orders.update(number, { payment: OPEN_ATTEMPT })
    const [saved] = t.orders.orders
    const reserved = t.stock.available(imperialPremium.id)

    let order: Awaited<ReturnType<typeof t.change.execute>> | undefined
    const events = await eventsOf(t, async () => {
      order = await t.change.execute(number, change('cancelled'))
    })

    expect(order).toMatchObject({ status: 'cancelled', paymentStatus: 'cancelled' })
    expect(order?.history.at(-1)).toMatchObject({ status: 'cancelled', note: null })
    expect(t.stock.available(imperialPremium.id)).toBe(reserved + 1)
    expect(events).toEqual([
      {
        type: 'order.cancelled',
        aggregateType: 'order',
        aggregateId: number,
        payload: { orderId: saved?.id, number, cancelledAttemptId: `${saved?.id ?? ''}:attempt` },
      },
      {
        type: 'storefront.stale',
        aggregateType: 'storefront',
        aggregateId: 'order.cancelled',
        payload: { reason: 'order.cancelled', tags: ['products', 'combos'] },
      },
    ])
  })

  it('cancelar sin intentos deja el pago en none y cancelledAttemptId en null', async () => {
    const t = setup()
    const number = await t.place()

    const events = await eventsOf(t, () => t.change.execute(number, change('cancelled')))
    const order = await t.get.execute(number)

    expect(order).toMatchObject({ status: 'cancelled', paymentStatus: 'none' })
    expect(events[0]?.payload).toMatchObject({ cancelledAttemptId: null })
  })

  it('con un pago en curso responde 409 payment_in_progress y no toca nada', async () => {
    const t = setup()
    const number = await t.place()
    t.orders.update(number, {
      paymentStatus: 'pending',
      payment: { ...OPEN_ATTEMPT, status: 'pending' },
    })
    const reserved = t.stock.available(imperialPremium.id)

    let error: unknown
    const events = await eventsOf(t, async () => {
      error = await rejection(t.change.execute(number, change('cancelled')))
    })

    expect(error).toBeInstanceOf(PaymentInProgressError)
    expect(error).toMatchObject({
      status: 409,
      code: 'payment_in_progress',
      title: 'Hay un pago en curso',
      detail: 'Hay un pago en curso: esperá a que se resuelva para cancelar el pedido.',
    })
    expect(events).toEqual([])
    expect(t.stock.available(imperialPremium.id)).toBe(reserved)
    await expect(t.get.execute(number)).resolves.toMatchObject({ status: 'pending_payment' })
  })

  it.each([
    [
      'un pedido pagado no se cancela',
      'paid',
      'cancelled',
      'El pedido está pagado: no puede pasar a cancelado.',
    ],
    [
      'despachar dos veces',
      'shipped',
      'shipped',
      'El pedido está despachado: no puede pasar a despachado.',
    ],
    [
      'un pedido entregado no vuelve a preparación',
      'delivered',
      'preparing',
      'El pedido está entregado: no puede pasar a en preparación.',
    ],
  ] as const)('%s: 409 invalid_status_transition', async (_name, status, target, detail) => {
    const t = setup()
    const number = await t.place()
    t.orders.update(number, { status, paymentStatus: 'approved' })
    const input = target === 'shipped' ? SHIP : change(target)

    let error: unknown
    const events = await eventsOf(t, async () => {
      error = await rejection(t.change.execute(number, input))
    })

    expect(error).toBeInstanceOf(InvalidStatusTransitionError)
    expect(error).toMatchObject({
      status: 409,
      code: 'invalid_status_transition',
      title: 'Transición inválida',
      detail,
    })
    expect(events).toEqual([])
  })

  it('vence antes de revisar: cancelar uno vencido da "está vencido"', async () => {
    const t = setup()
    const number = await t.place()
    t.clock.advance(31 * MINUTE)

    const error = await rejection(t.change.execute(number, change('cancelled')))

    expect(error).toMatchObject({
      code: 'invalid_status_transition',
      detail: 'El pedido está vencido: no puede pasar a cancelado.',
    })
  })

  it('si otro lo cambió en el medio, vuelve a leer y responde el 409 que corresponde', async () => {
    const t = setup()
    const number = await paidOrder(t)
    const original = t.adminOrders.changeStatus.bind(t.adminOrders)
    vi.spyOn(t.adminOrders, 'changeStatus').mockImplementationOnce((...args) => {
      // Otra pestaña lo despacha justo antes del UPDATE condicional.
      t.orders.update(number, { status: 'shipped' })
      return original(...args)
    })

    const error = await rejection(t.change.execute(number, SHIP))

    expect(error).toMatchObject({
      code: 'invalid_status_transition',
      detail: 'El pedido está despachado: no puede pasar a despachado.',
    })
  })

  it('un número que no existe da 404', async () => {
    const t = setup()
    await expect(t.change.execute('GLP-99999', change('preparing'))).rejects.toBeInstanceOf(
      AdminOrderNotFoundError,
    )
  })

  it('valida la entrada: el despacho necesita empresa y seguimiento, el resto va en null', async () => {
    const t = setup()
    const number = await paidOrder(t)

    await expect(t.change.execute(number, change('shipped'))).rejects.toThrow(TypeError)
    await expect(
      t.change.execute(number, change('preparing', { carrier: 'Andreani' })),
    ).rejects.toThrow(TypeError)
    await expect(t.change.execute(number, change('paid' as 'preparing'))).rejects.toThrow(
      RangeError,
    )
  })
})
