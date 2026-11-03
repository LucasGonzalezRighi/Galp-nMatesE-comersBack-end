import { Logger } from '@nestjs/common'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Env } from '../../../config/env'
import type { ExpireOrdersCommand } from '../../orders/application/commands/expire-orders.command'
import type { ReconcilePendingPaymentsCommand } from '../application/commands/reconcile-pending-payments.command'
import type { ReprocessWebhookEventsCommand } from '../application/commands/reprocess-webhook-events.command'
import { PAYMENTS_SWEEP_INTERVAL_MS, PaymentsSweep } from './payments-sweep'

function sweepWith(
  nodeEnv: Env['NODE_ENV'],
  overrides: {
    expireDue?: () => Promise<unknown>
    reconcile?: () => Promise<unknown>
    reprocess?: () => Promise<unknown>
  } = {},
) {
  const order: string[] = []
  const expire = {
    expireDue: vi.fn(() => {
      order.push('expireDue')
      return overrides.expireDue?.() ?? Promise.resolve({ expired: 1, failed: [] })
    }),
  }
  const reconcile = {
    execute: vi.fn(() => {
      order.push('reconcile')
      return overrides.reconcile?.() ?? Promise.resolve({ reconciled: 2, expired: 1, failed: 0 })
    }),
  }
  const reprocess = {
    execute: vi.fn(() => {
      order.push('reprocess')
      return overrides.reprocess?.() ?? Promise.resolve({ processed: 3, failed: 0 })
    }),
  }
  const sweep = new PaymentsSweep(
    expire as unknown as ExpireOrdersCommand,
    reconcile as unknown as ReconcilePendingPaymentsCommand,
    reprocess as unknown as ReprocessWebhookEventsCommand,
    { NODE_ENV: nodeEnv } as Env,
  )
  return { expire, order, reconcile, reprocess, sweep }
}

describe('PaymentsSweep', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('con NODE_ENV=test no arranca el temporizador', async () => {
    vi.useFakeTimers()
    const { reconcile, sweep } = sweepWith('test')

    sweep.onModuleInit()
    await vi.advanceTimersByTimeAsync(3 * PAYMENTS_SWEEP_INTERVAL_MS)

    expect(reconcile.execute).not.toHaveBeenCalled()
    await sweep.onModuleDestroy()
  })

  it('fuera de test corre cada 60 s y se detiene al cerrar', async () => {
    vi.useFakeTimers()
    const { reconcile, sweep } = sweepWith('development')

    sweep.onModuleInit()
    await vi.advanceTimersByTimeAsync(2 * PAYMENTS_SWEEP_INTERVAL_MS)
    await sweep.onModuleDestroy()
    await vi.advanceTimersByTimeAsync(3 * PAYMENTS_SWEEP_INTERVAL_MS)

    expect(PAYMENTS_SWEEP_INTERVAL_MS).toBe(60_000)
    expect(reconcile.execute).toHaveBeenCalledTimes(2)
  })

  it('runOnce vence, concilia y reprocesa, en ese orden, y devuelve los conteos', async () => {
    const { expire, order, sweep } = sweepWith('test')

    await expect(sweep.runOnce()).resolves.toEqual({
      expired: 1,
      reconcile: { reconciled: 2, expired: 1, failed: 0 },
      reprocess: { processed: 3, failed: 0 },
    })
    expect(order).toEqual(['expireDue', 'reconcile', 'reprocess'])
    expect(expire.expireDue).toHaveBeenCalledWith(50)
  })

  it('un paso que falla se avisa y no frena a los demás; runOnce nunca lanza', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const { order, sweep } = sweepWith('test', {
      expireDue: () => Promise.reject(new Error('Postgres caído')),
      reconcile: () => Promise.reject(new Error('MP no contesta')),
    })

    await expect(sweep.runOnce()).resolves.toEqual({
      expired: 0,
      reconcile: { reconciled: 0, expired: 0, failed: 0 },
      reprocess: { processed: 3, failed: 0 },
    })
    expect(order).toEqual(['expireDue', 'reconcile', 'reprocess'])
    const messages = warn.mock.calls.map(([message]) => String(message))
    expect(messages.some((message) => message.includes('Postgres caído'))).toBe(true)
    expect(messages.some((message) => message.includes('MP no contesta'))).toBe(true)
  })

  it('si ya hay una vuelta en curso, runOnce devuelve esa', async () => {
    const { reconcile, sweep } = sweepWith('test')

    const [first, second] = await Promise.all([sweep.runOnce(), sweep.runOnce()])

    expect(first).toBe(second)
    expect(reconcile.execute).toHaveBeenCalledTimes(1)
  })
})
