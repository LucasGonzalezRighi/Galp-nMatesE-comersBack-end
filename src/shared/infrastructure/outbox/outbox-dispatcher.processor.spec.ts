import { Logger } from '@nestjs/common'
import type { Job, Queue } from 'bullmq'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { FixedClock } from '../../../../test/support/identity'
import { InMemoryOutboxEvents } from '../../../../test/support/outbox'
import { newId } from '../../domain/id'
import { OutboxDispatcherProcessor } from './outbox-dispatcher.processor'
import { OutboxHandlerRegistry } from './outbox-handler.registry'
import type { OutboxJobData } from './outbox.relay'

/** Cola falsa: `getJobCounts` contesta (Redis arriba). */
function fakeQueue() {
  return { on: vi.fn(), getJobCounts: vi.fn(() => Promise.resolve({})) }
}

function dispatcher(registry = new OutboxHandlerRegistry()) {
  const queue = fakeQueue()
  const outbox = new InMemoryOutboxEvents()
  const clock = new FixedClock()
  const processor = new OutboxDispatcherProcessor(
    registry,
    queue as unknown as Queue<OutboxJobData>,
    outbox,
    clock,
  )
  return { processor, queue, registry, outbox, clock }
}

/** Job de BullMQ falso: por defecto, el primer intento de 5 y todavía no fallido del todo. */
function job(
  name: string,
  data: unknown,
  state: { attemptsMade?: number; failed?: boolean } = {},
): Job<OutboxJobData> {
  return {
    id: 'j1',
    name,
    data,
    attemptsMade: state.attemptsMade ?? 1,
    opts: { attempts: 5 },
    isFailed: () => Promise.resolve(state.failed ?? false),
  } as unknown as Job<OutboxJobData>
}

describe('OutboxDispatcherProcessor', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('despacha por job.name a todos los handlers del tipo, en orden', async () => {
    const { processor, registry, outbox } = dispatcher()
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
    const data = outbox.save({ id: newId(), type: 'combo.changed', payload: {} })

    await processor.process(job('combo.changed', data))

    expect(calls).toEqual([`primero ${data.id}`, `segundo ${data.id}`])
  })

  it('un tipo sin handlers termina sin hacer nada', async () => {
    const { processor, outbox } = dispatcher()
    const data = outbox.save({ id: newId(), type: 'order.created', payload: {} })

    await expect(processor.process(job('order.created', data))).resolves.toBeUndefined()
  })

  it('si un handler lanza, el job falla', async () => {
    const { processor, registry, outbox } = dispatcher()
    registry.register('combo.changed', {
      handle: () => Promise.reject(new Error('Redis caído')),
    })
    const data = outbox.save({ id: newId(), type: 'combo.changed', payload: {} })

    await expect(processor.process(job('combo.changed', data))).rejects.toThrow('Redis caído')
  })

  describe('NV-27: el job no manda, manda el evento guardado en Postgres', () => {
    it('un job que nombra otro pedido que el evento guardado no llega a los handlers', async () => {
      const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
      const { processor, registry, outbox } = dispatcher()
      const handle = vi.fn(() => Promise.resolve())
      registry.register('order.expired', { handle })
      const stored = outbox.save({
        id: newId(),
        type: 'order.expired',
        payload: { orderId: 'pedido-vencido', number: 'GLP-10001' },
      })

      await processor.process(
        job('order.expired', { ...stored, payload: { orderId: 'pedido-pagado' } }),
      )

      expect(handle).not.toHaveBeenCalled()
      expect(String(error.mock.calls[0]?.[0])).toContain(stored.id)
    })

    it('un job con un id que no está en el outbox (o de otro tipo) se descarta', async () => {
      vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
      const { processor, registry, outbox } = dispatcher()
      const handle = vi.fn(() => Promise.resolve())
      registry.register('order.expired', { handle })
      registry.register('order.cancelled', { handle })
      const paid = outbox.save({
        id: newId(),
        type: 'order.paid',
        payload: { orderId: 'pedido-pagado' },
      })

      await processor.process(
        job('order.expired', { id: newId(), payload: { orderId: 'pedido-pagado' } }),
      )
      await processor.process(job('order.cancelled', { ...paid, type: 'order.cancelled' }))
      await processor.process(job('order.expired', 'basura'))

      expect(handle).not.toHaveBeenCalled()
    })

    it('a los handlers les llega el evento guardado', async () => {
      const { processor, registry, outbox } = dispatcher()
      const handle = vi.fn(() => Promise.resolve())
      registry.register('order.expired', { handle })
      const stored = outbox.save({
        id: newId(),
        type: 'order.expired',
        payload: { orderId: 'o1', number: 'GLP-10001' },
      })

      await processor.process(job('order.expired', stored))

      expect(handle).toHaveBeenCalledWith(stored)
    })
  })

  describe('NV-29: un despacho que agota los reintentos no pierde el evento', () => {
    it('un fallo con reintentos pendientes solo avisa (una vez por minuto)', async () => {
      const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
      const { processor, queue, outbox } = dispatcher()
      const data = outbox.save({ id: newId(), type: 'order.expired', payload: {} })

      await processor.onFailed(job('order.expired', data), new Error('Postgres caído'))
      await processor.onFailed(undefined, new Error('otra vez'))

      expect(warn).toHaveBeenCalledTimes(1)
      expect(String(warn.mock.calls[0]?.[0])).toContain('order.expired')
      expect(outbox.reopened).toEqual([])
      expect(queue.on).toHaveBeenCalledWith('error', expect.any(Function))
    })

    it('el último intento fallido vuelve a dejar el evento pendiente, con espera', async () => {
      vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
      const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
      const { processor, outbox, clock } = dispatcher()
      const data = outbox.save({ id: newId(), type: 'order.expired', payload: {} })

      await processor.onFailed(
        job('order.expired', data, { attemptsMade: 5, failed: true }),
        new Error('Postgres caído'),
      )

      expect(outbox.reopened).toEqual([{ id: data.id, at: clock.now() }])
      expect(outbox.events.get(data.id)?.dispatchFailures).toBe(1)
      expect(error).toHaveBeenCalledTimes(1)
      expect(String(error.mock.calls[0]?.[0])).toContain('vuelve a quedar pendiente')
    })

    it('un job trabado que BullMQ dio por fallido también se reabre', async () => {
      vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
      const { processor, outbox } = dispatcher()
      const data = outbox.save({ id: newId(), type: 'order.cancelled', payload: {} })

      await processor.onFailed(
        job('order.cancelled', data, { attemptsMade: 1, failed: true }),
        new Error('job stalled more than allowable limit'),
      )

      expect(outbox.reopened.map((call) => call.id)).toEqual([data.id])
    })

    it('después del tope queda un error en el log y no se reabre más', async () => {
      const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
      const { processor, outbox } = dispatcher()
      const data = outbox.save({ id: newId(), type: 'order.expired', payload: {} })
      const stored = outbox.events.get(data.id)
      if (stored !== undefined) stored.dispatchFailures = 8

      await processor.onFailed(
        job('order.expired', data, { attemptsMade: 5, failed: true }),
        new Error('Postgres caído'),
      )

      expect(stored?.dispatchFailures).toBe(8)
      expect(String(error.mock.calls.at(-1)?.[0])).toContain('se perdió')
    })

    it('si no se puede reabrir (Postgres caído), lo dice en el log y no lanza', async () => {
      const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
      const { processor, outbox } = dispatcher()
      const data = outbox.save({ id: newId(), type: 'order.expired', payload: {} })
      vi.spyOn(outbox, 'reopenAfterDispatchFailure').mockRejectedValue(new Error('sin base'))

      await expect(
        processor.onFailed(
          job('order.expired', data, { attemptsMade: 5, failed: true }),
          new Error('Postgres caído'),
        ),
      ).resolves.toBeUndefined()

      expect(String(error.mock.calls.at(-1)?.[0])).toContain('sin base')
    })
  })

  it('sin app.init() no hay worker y el cierre no hace nada', async () => {
    const { processor } = dispatcher()

    await expect(processor.onModuleDestroy()).resolves.toBeUndefined()
  })
})
