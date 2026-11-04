import type { Job, Queue } from 'bullmq'
import { describe, expect, it, vi } from 'vitest'

import { OutboxDispatcherProcessor } from '../../../shared/infrastructure/outbox/outbox-dispatcher.processor'
import { OutboxHandlerRegistry } from '../../../shared/infrastructure/outbox/outbox-handler.registry'
import type { OutboxJobData } from '../../../shared/infrastructure/outbox/outbox.relay'
import type { OnOrderCancelledCommand } from '../application/commands/on-order-cancelled.command'
import { OrderCancelledOutboxHandler } from './order-cancelled.outbox-handler'

/** Despachador del outbox con el handler de payments registrado (como en la app). */
function outboxProcessor() {
  const onCancelled = { execute: vi.fn(() => Promise.resolve()) }
  const registry = new OutboxHandlerRegistry()
  const handler = new OrderCancelledOutboxHandler(
    registry,
    onCancelled as unknown as OnOrderCancelledCommand,
  )
  const queue = { on: vi.fn(), getJobCounts: vi.fn(() => Promise.resolve({})) }
  const processor = new OutboxDispatcherProcessor(
    registry,
    queue as unknown as Queue<OutboxJobData>,
  )
  return { handler, onCancelled, processor, registry }
}

function job(name: string, data: Partial<OutboxJobData>): Job<OutboxJobData> {
  return { id: 'j1', name, data: { id: 'j1', type: name, ...data } } as Job<OutboxJobData>
}

describe('OrderCancelledOutboxHandler', () => {
  it('se registra para order.cancelled al crearse', () => {
    const { handler, registry } = outboxProcessor()

    expect(registry.handlersFor('order.cancelled')).toEqual([handler])
  })

  it('order.cancelled cierra en la pasarela el intento que canceló el pedido (Ruling B-75)', async () => {
    const { onCancelled, processor } = outboxProcessor()

    await processor.process(
      job('order.cancelled', {
        payload: { orderId: 'o1', number: 'GLP-10001', cancelledAttemptId: 'p1' },
      }),
    )
    await processor.process(
      job('order.cancelled', {
        payload: { orderId: 'o2', number: 'GLP-10002', cancelledAttemptId: null },
      }),
    )

    expect(onCancelled.execute.mock.calls).toEqual([
      ['o1', 'p1'],
      ['o2', null],
    ])
  })

  it('los demás eventos se aceptan sin hacer nada', async () => {
    const { onCancelled, processor } = outboxProcessor()

    await processor.process(job('order.expired', { payload: { orderId: 'o1' } }))
    await processor.process(job('order.shipped', { payload: { orderId: 'o1' } }))

    expect(onCancelled.execute).not.toHaveBeenCalled()
  })

  it('un order.cancelled sin orderId falla', async () => {
    const { processor } = outboxProcessor()

    await expect(
      processor.process(job('order.cancelled', { payload: { cancelledAttemptId: null } })),
    ).rejects.toThrow(new TypeError('El evento j1 (order.cancelled) no trae el id del pedido'))
  })

  it('un cancelledAttemptId que no es texto ni null falla', async () => {
    const { processor } = outboxProcessor()

    await expect(
      processor.process(job('order.cancelled', { payload: { orderId: 'o1' } })),
    ).rejects.toThrow(TypeError)
  })
})
