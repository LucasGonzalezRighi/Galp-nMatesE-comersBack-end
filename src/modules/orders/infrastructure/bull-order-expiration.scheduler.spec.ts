import { Logger } from '@nestjs/common'
import type { Queue } from 'bullmq'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Clock } from '../../../shared/domain/clock'
import { BullOrderExpirationScheduler } from './bull-order-expiration.scheduler'
import { ORDER_EXPIRE_JOB, type OrderExpireJobData } from './order-expiration.queue'

const NOW = new Date('2026-11-02T12:00:00.000Z')
const clock: Clock = { now: () => new Date(NOW) }

/** Cola falsa: `add` hace lo que diga el test y `on` no hace nada. */
function fakeQueue(add: (...args: unknown[]) => Promise<unknown>) {
  const queue = { on: vi.fn(), add: vi.fn(add) }
  return {
    queue,
    scheduler: new BullOrderExpirationScheduler(
      queue as unknown as Queue<OrderExpireJobData>,
      clock,
    ),
  }
}

describe('BullOrderExpirationScheduler', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('encola order.expire con jobId = id del pedido y delay hasta reservedUntil', async () => {
    const { queue, scheduler } = fakeQueue(() => Promise.resolve({}))

    await scheduler.schedule('pedido-1', new Date(NOW.getTime() + 30 * 60_000))

    expect(queue.add).toHaveBeenCalledWith(
      ORDER_EXPIRE_JOB,
      { orderId: 'pedido-1' },
      expect.objectContaining({
        jobId: 'pedido-1',
        delay: 30 * 60_000,
        attempts: 5,
        backoff: { type: 'exponential', delay: 1_000 },
        removeOnComplete: { age: 7 * 24 * 60 * 60 },
      }),
    )
  })

  it('con reservedUntil en el pasado encola sin demora', async () => {
    const { queue, scheduler } = fakeQueue(() => Promise.resolve({}))

    await scheduler.schedule('pedido-2', new Date(NOW.getTime() - 1_000))

    expect(queue.add).toHaveBeenCalledWith(
      ORDER_EXPIRE_JOB,
      { orderId: 'pedido-2' },
      expect.objectContaining({ delay: 0 }),
    )
  })

  it('falla abierta: si la cola no responde avisa con warn y no lanza', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const { scheduler } = fakeQueue(() => Promise.reject(new Error("Stream isn't writeable")))

    await expect(scheduler.schedule('pedido-3', NOW)).resolves.toBeUndefined()

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('pedido-3'))
  })

  it('escucha los errores de la cola (sin listener, un error de Redis rompería el proceso)', () => {
    const { queue } = fakeQueue(() => Promise.resolve({}))

    expect(queue.on).toHaveBeenCalledWith('error', expect.any(Function))
  })

  it('rechaza un id vacío o una fecha inválida', async () => {
    const { scheduler } = fakeQueue(() => Promise.resolve({}))

    await expect(scheduler.schedule('', NOW)).rejects.toThrow(TypeError)
    await expect(scheduler.schedule('pedido-4', new Date(Number.NaN))).rejects.toThrow(
      'no es una fecha válida',
    )
  })
})
