import { Logger } from '@nestjs/common'
import type { Job, Queue } from 'bullmq'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { OutboxDispatcherProcessor } from './outbox-dispatcher.processor'
import { OutboxHandlerRegistry } from './outbox-handler.registry'
import type { OutboxJobData } from './outbox.relay'

/** Cola falsa: `getJobCounts` contesta (Redis arriba). */
function fakeQueue() {
  return { on: vi.fn(), getJobCounts: vi.fn(() => Promise.resolve({})) }
}

function dispatcher(registry = new OutboxHandlerRegistry()) {
  const queue = fakeQueue()
  const processor = new OutboxDispatcherProcessor(
    registry,
    queue as unknown as Queue<OutboxJobData>,
  )
  return { processor, queue, registry }
}

function job(name: string, data: unknown): Job<OutboxJobData> {
  return { id: 'j1', name, data } as Job<OutboxJobData>
}

describe('OutboxDispatcherProcessor', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('despacha por job.name a todos los handlers del tipo, en orden', async () => {
    const { processor, registry } = dispatcher()
    const calls: string[] = []
    registry.register('combo.changed', {
      handle: (event) => {
        calls.push(`primero ${event.id}`)
        return Promise.resolve()
      },
    })
    registry.register('combo.changed', {
      handle: (event) => {
        calls.push(`segundo ${event.id}`)
        return Promise.resolve()
      },
    })
    registry.register('order.expired', {
      handle: () => {
        calls.push('otro tipo')
        return Promise.resolve()
      },
    })

    await processor.process(job('combo.changed', { id: 'e1', payload: {} }))

    expect(calls).toEqual(['primero e1', 'segundo e1'])
  })

  it('un tipo sin handlers termina sin hacer nada', async () => {
    const { processor } = dispatcher()

    await expect(processor.process(job('order.created', { id: 'e1' }))).resolves.toBeUndefined()
  })

  it('si un handler lanza, el job falla', async () => {
    const { processor, registry } = dispatcher()
    registry.register('combo.changed', {
      handle: () => Promise.reject(new Error('Redis caído')),
    })

    await expect(processor.process(job('combo.changed', { id: 'e1' }))).rejects.toThrow(
      'Redis caído',
    )
  })

  it('avisa (una vez por minuto) cuando falla un job', () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const { processor, queue } = dispatcher()

    processor.onFailed(job('order.expired', {}), new Error('Postgres caído'))
    processor.onFailed(undefined, new Error('otra vez'))

    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]?.[0])).toContain('order.expired')
    expect(queue.on).toHaveBeenCalledWith('error', expect.any(Function))
  })

  it('sin app.init() no hay worker y el cierre no hace nada', async () => {
    const { processor } = dispatcher()

    await expect(processor.onModuleDestroy()).resolves.toBeUndefined()
  })
})
