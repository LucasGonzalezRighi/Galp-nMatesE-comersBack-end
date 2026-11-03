import { Logger } from '@nestjs/common'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Env } from '../../../config/env'
import type { ExpireOrdersCommand } from '../application/commands/expire-orders.command'
import { ORDER_EXPIRATION_SWEEP_INTERVAL_MS, OrderExpirationSweep } from './order-expiration.sweep'

/** Barrido con un `expireDue` falso y el `NODE_ENV` pedido. */
function sweepWith(expireDue: () => Promise<number>, nodeEnv: Env['NODE_ENV']) {
  const expire = { expireDue: vi.fn(expireDue) }
  const sweep = new OrderExpirationSweep(
    expire as unknown as ExpireOrdersCommand,
    { NODE_ENV: nodeEnv } as Env,
  )
  return { expire, sweep }
}

describe('OrderExpirationSweep', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('con NODE_ENV=test no arranca el temporizador', async () => {
    vi.useFakeTimers()
    const { expire, sweep } = sweepWith(() => Promise.resolve(0), 'test')

    sweep.onModuleInit()
    await vi.advanceTimersByTimeAsync(3 * ORDER_EXPIRATION_SWEEP_INTERVAL_MS)

    expect(expire.expireDue).not.toHaveBeenCalled()
    await sweep.onModuleDestroy()
  })

  it('fuera de test vence una tanda cada 60 s y se detiene al cerrar', async () => {
    vi.useFakeTimers()
    const { expire, sweep } = sweepWith(() => Promise.resolve(1), 'production')

    sweep.onModuleInit()
    await vi.advanceTimersByTimeAsync(ORDER_EXPIRATION_SWEEP_INTERVAL_MS)
    await vi.advanceTimersByTimeAsync(ORDER_EXPIRATION_SWEEP_INTERVAL_MS)
    await sweep.onModuleDestroy()
    await vi.advanceTimersByTimeAsync(3 * ORDER_EXPIRATION_SWEEP_INTERVAL_MS)

    expect(ORDER_EXPIRATION_SWEEP_INTERVAL_MS).toBe(60_000)
    expect(expire.expireDue).toHaveBeenCalledTimes(2)
  })

  it('runOnce vence hasta 50 pedidos y devuelve cuántos', async () => {
    const { expire, sweep } = sweepWith(() => Promise.resolve(3), 'test')

    await expect(sweep.runOnce()).resolves.toBe(3)
    expect(expire.expireDue).toHaveBeenCalledWith(50)
  })

  it('runOnce no lanza si falla la base: avisa y cuenta 0', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const { sweep } = sweepWith(() => Promise.reject(new Error('Postgres caído')), 'test')

    await expect(sweep.runOnce()).resolves.toBe(0)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Postgres caído'))
  })

  it('dos runOnce a la vez comparten la misma vuelta', async () => {
    const { expire, sweep } = sweepWith(() => Promise.resolve(2), 'test')

    const [first, second] = await Promise.all([sweep.runOnce(), sweep.runOnce()])

    expect([first, second]).toEqual([2, 2])
    expect(expire.expireDue).toHaveBeenCalledTimes(1)
  })
})
