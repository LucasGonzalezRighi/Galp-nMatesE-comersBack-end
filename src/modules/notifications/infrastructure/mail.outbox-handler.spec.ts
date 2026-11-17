import type { Job, JobsOptions, Queue } from 'bullmq'
import { describe, expect, it } from 'vitest'

import { OutboxHandlerRegistry } from '../../../shared/infrastructure/outbox/outbox-handler.registry'
import type { OutboxJobData } from '../../../shared/infrastructure/outbox/outbox.relay'
import { MailOutboxHandler } from './mail.outbox-handler'
import type { MailJobData } from './mail.queue'

/** Cola en memoria que, como BullMQ, ignora un job con un `jobId` que ya tiene. */
class FakeQueue {
  readonly jobs = new Map<string, { name: string; data: MailJobData; opts: JobsOptions }>()

  add(name: string, data: MailJobData, opts: JobsOptions = {}): Promise<Job<MailJobData>> {
    const id = opts.jobId ?? String(this.jobs.size)
    if (!this.jobs.has(id)) this.jobs.set(id, { name, data, opts })
    return Promise.resolve({ id } as Job<MailJobData>)
  }
}

function event(type: string, payload: unknown, id = '01900000-0000-7000-8000-000000000001') {
  return {
    id,
    type,
    aggregateType: 'order',
    aggregateId: 'GLP-10001',
    occurredAt: '2026-11-17T12:00:00.000Z',
    payload,
  } satisfies OutboxJobData
}

function setup() {
  const registry = new OutboxHandlerRegistry()
  const queue = new FakeQueue()
  const handler = new MailOutboxHandler(registry, queue as Pick<Queue<MailJobData>, 'add'>)
  return { registry, queue, handler }
}

describe('MailOutboxHandler', () => {
  it('se registra para los eventos que mandan mail, incluidos los tres nuevos', () => {
    const { registry, handler } = setup()
    for (const type of [
      'order.created',
      'order.paid',
      'order.shipped',
      'order.delivered',
      'order.cancelled',
      'order.expired',
      'withdrawal.requested',
      'contact.received',
      'customer.registered',
    ]) {
      expect(registry.handlersFor(type)).toEqual([handler])
    }
    expect(registry.handlersFor('combo.changed')).toEqual([])
  })

  it('encola mail.send con solo el payload del evento y jobId = evento + plantilla', async () => {
    const { queue, handler } = setup()

    await handler.handle(event('order.created', { orderId: 'o1', number: 'GLP-10001' }))

    const [id, job] = [...queue.jobs][0] ?? []
    expect(id).toBe('01900000-0000-7000-8000-000000000001-order-received')
    expect(job?.name).toBe('mail.send')
    expect(job?.data).toEqual({
      kind: 'event',
      eventId: '01900000-0000-7000-8000-000000000001',
      eventType: 'order.created',
      template: 'order-received',
      payload: { orderId: 'o1', number: 'GLP-10001' },
    })
    expect(job?.opts).toMatchObject({ attempts: 5, backoff: { type: 'exponential' } })
  })

  it('un order.paid que el outbox entrega dos veces deja un solo job (Review Focus 1)', async () => {
    const { queue, handler } = setup()
    const paid = event('order.paid', { orderId: 'o1', number: 'GLP-10001' })

    await handler.handle(paid)
    await handler.handle(paid)

    expect(queue.jobs.size).toBe(1)
  })

  it('un evento sin mail no encola nada', async () => {
    const { queue, handler } = setup()
    await handler.handle(event('storefront.stale', { tags: ['products'] }))
    expect(queue.jobs.size).toBe(0)
  })
})
