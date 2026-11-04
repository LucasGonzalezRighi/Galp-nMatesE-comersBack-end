import { describe, expect, it, vi } from 'vitest'

import { createPaymentsHarness, ORDER_TOKEN } from '../../../../../test/support/payments'
import { OnOrderCancelledCommand } from './on-order-cancelled.command'

const KEY = '7c9e6679-7425-40de-944b-e07fc1f90a01'

/** Pedido con un Checkout Pro abierto que `orders` ya canceló (como hace la cancelación del admin). */
async function setup() {
  const h = createPaymentsHarness()
  const order = h.orders.add()
  await h.preference.execute({ number: order.number, token: ORDER_TOKEN }, KEY)
  const [attempt] = h.payments.of(order.id)
  if (attempt === undefined) throw new Error('No se creó el intento')
  await h.payments.update(attempt.id, { status: 'cancelled', isActive: false, challengeUrl: null })
  const closePayments = { execute: vi.fn((orderId: string) => h.onExpired.execute(orderId)) }
  const command = new OnOrderCancelledCommand(h.payments, h.gateway, closePayments, h.logger)
  return { h, order, attempt, closePayments, command }
}

describe('OnOrderCancelledCommand', () => {
  it('vence en Mercado Pago la preferencia del intento cancelado y cierra el resto de los pagos', async () => {
    const { h, order, attempt, closePayments, command } = await setup()

    await command.execute(order.id, attempt.id)

    expect(h.gateway.callsTo('expirePreference')).toEqual([['sim-pref-1']])
    expect(closePayments.execute).toHaveBeenCalledWith(order.id)
    expect(h.payments.of(order.id)).toEqual([
      expect.objectContaining({ id: attempt.id, status: 'cancelled', isActive: false }),
    ])
  })

  it('sin intento cancelado no llama a la pasarela, pero igual cierra los pagos del pedido', async () => {
    const { h, order, closePayments, command } = await setup()

    await command.execute(order.id, null)

    expect(h.gateway.callsTo('expirePreference')).toEqual([])
    expect(closePayments.execute).toHaveBeenCalledWith(order.id)
  })

  it('un intento de otro pedido (o que no existe) se ignora', async () => {
    const { h, attempt, command } = await setup()
    const other = h.orders.add()

    await command.execute(other.id, attempt.id)
    await command.execute(other.id, '0190a6f0-0000-7000-8000-000000000000')

    expect(h.gateway.callsTo('expirePreference')).toEqual([])
  })

  it('valida los ids', async () => {
    const { command } = await setup()

    await expect(command.execute('', null)).rejects.toThrow(TypeError)
    await expect(command.execute('o1', '')).rejects.toThrow(TypeError)
  })
})
