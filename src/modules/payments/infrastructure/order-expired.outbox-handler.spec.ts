import type { Job, Queue } from 'bullmq'
import { describe, expect, it, vi } from 'vitest'

import { FixedClock } from '../../../../test/support/identity'
import { InMemoryOutboxEvents } from '../../../../test/support/outbox'

import { OutboxDispatcherProcessor } from '../../../shared/infrastructure/outbox/outbox-dispatcher.processor'
import { OutboxHandlerRegistry } from '../../../shared/infrastructure/outbox/outbox-handler.registry'
import type { OutboxJobData } from '../../../shared/infrastructure/outbox/outbox.relay'
import type { OnOrderExpiredCommand } from '../application/commands/on-order-expired.command'
import { OrderExpiredOutboxHandler } from './order-expired.outbox-handler'

/** Despachador del outbox con el handler de payments registrado (como en la app). */
function outboxProcessor(execute: () => Promise<void> = () => Promise.resolve()) {
  const onExpired = { execute: vi.fn(execute) }
  const registry = new OutboxHandlerRegistry()
  const handler = new OrderExpiredOutboxHandler(
    registry,
    onExpired as unknown as OnOrderExpiredCommand,
  )
  const queue = { on: vi.fn(), getJobCounts: vi.fn(() => Promise.resolve({})) }
  const processor = new OutboxDispatcherProcessor(
    registry,
    queue as unknown as Queue<OutboxJobData>,
    outbox,
    new FixedClock(),
  )
  return { handler, onExpired, processor, registry }
}

/** Eventos que el despachador relee antes de actuar (NV-27): cada `job` guarda el suyo. */
const outbox = new InMemoryOutboxEvents()

function job(name: string, data: Partial<OutboxJobData>): Job<OutboxJobData> {
  const saved = outbox.save({ id: 'j1', type: name, payload: data.payload })
  return { id: 'j1', name, data: saved } as Job<OutboxJobData>
}

describe('OrderExpiredOutboxHandler', () => {
  it('se registra para order.expired al crearse', () => {
    const { handler, registry } = outboxProcessor()

    expect(registry.handlersFor('order.expired')).toEqual([handler])
  })

  it('order.expired cancela el intento activo del pedido (Ruling B-43)', async () => {
    const { onExpired, processor } = outboxProcessor()

    await processor.process(
      job('order.expired', { payload: { orderId: 'o1', number: 'GLP-10001' } }),
    )

    expect(onExpired.execute).toHaveBeenCalledWith('o1')
  })

  it('los demás eventos se aceptan sin hacer nada', async () => {
    const { onExpired, processor } = outboxProcessor()

    await processor.process(job('order.created', { payload: { number: 'GLP-10001' } }))
    await processor.process(job('order.paid', { payload: { orderId: 'o1' } }))

    expect(onExpired.execute).not.toHaveBeenCalled()
  })

  it('un order.expired sin orderId falla', async () => {
    const { processor } = outboxProcessor()

    await expect(processor.process(job('order.expired', { payload: {} }))).rejects.toThrow(
      'no trae el id del pedido',
    )
  })
})
