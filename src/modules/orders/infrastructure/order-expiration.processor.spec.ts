import type { Job, Queue } from 'bullmq'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ExpireOrdersCommand } from '../application/commands/expire-orders.command'
import type { OrderExpireJobData } from './order-expiration.queue'
import { OrderExpirationProcessor, WORKER_SHUTDOWN_PROBE_MS } from './order-expiration.processor'

/** Processor con un `expireOne` y una cola falsos; `worker` simula el que crea `app.init()`. */
function processorWith(options: {
  expireOne?: () => Promise<unknown>
  getJobCounts?: () => Promise<unknown>
  worker?: { close: (force: boolean) => Promise<void> }
}) {
  const expire = { expireOne: vi.fn(options.expireOne ?? (() => Promise.resolve(null))) }
  const queue = { getJobCounts: vi.fn(options.getJobCounts ?? (() => Promise.resolve({}))) }
  const processor = new OrderExpirationProcessor(
    expire as unknown as ExpireOrdersCommand,
    queue as unknown as Queue<OrderExpireJobData>,
  )
  if (options.worker !== undefined) Reflect.set(processor, '_worker', options.worker)
  return { expire, processor }
}

/** Job falso con los datos pedidos. */
function job(data: unknown): Job<OrderExpireJobData> {
  return { id: 'j1', data } as Job<OrderExpireJobData>
}

describe('OrderExpirationProcessor', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('vence el pedido del job y avisa si lo venció', async () => {
    const { expire, processor } = processorWith({ expireOne: () => Promise.resolve({}) })

    await expect(processor.process(job({ orderId: 'o1' }))).resolves.toBe(true)
    expect(expire.expireOne).toHaveBeenCalledWith('o1')
  })

  it('devuelve false si el pedido no correspondía (pagado o ya vencido)', async () => {
    const { processor } = processorWith({ expireOne: () => Promise.resolve(null) })

    await expect(processor.process(job({ orderId: 'o1' }))).resolves.toBe(false)
  })

  it('un job sin id de pedido falla', async () => {
    const { processor } = processorWith({})

    await expect(processor.process(job({}))).rejects.toThrow('no trae el id del pedido')
  })

  it('al cerrar con Redis arriba cierra el worker esperando el job en curso', async () => {
    const close = vi.fn(() => Promise.resolve())
    const { processor } = processorWith({ worker: { close } })

    await processor.onModuleDestroy()

    expect(close).toHaveBeenCalledWith(false)
  })

  it('al cerrar con Redis caído (la cola falla) cierra el worker forzado', async () => {
    const close = vi.fn(() => Promise.resolve())
    const { processor } = processorWith({
      worker: { close },
      getJobCounts: () => Promise.reject(new Error("Stream isn't writeable")),
    })

    await processor.onModuleDestroy()

    expect(close).toHaveBeenCalledWith(true)
  })

  it('si Redis no contesta a tiempo también lo cierra forzado', async () => {
    vi.useFakeTimers()
    const close = vi.fn(() => Promise.resolve())
    const { processor } = processorWith({
      worker: { close },
      getJobCounts: () => new Promise(() => undefined),
    })

    const closing = processor.onModuleDestroy()
    await vi.advanceTimersByTimeAsync(WORKER_SHUTDOWN_PROBE_MS)
    await closing

    expect(close).toHaveBeenCalledWith(true)
  })

  it('sin app.init() no hay worker y el cierre no hace nada', async () => {
    const { processor } = processorWith({})

    await expect(processor.onModuleDestroy()).resolves.toBeUndefined()
  })
})
