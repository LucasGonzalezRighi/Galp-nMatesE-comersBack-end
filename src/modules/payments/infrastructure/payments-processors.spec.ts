import { Logger } from '@nestjs/common'
import type { Job, Queue } from 'bullmq'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { OutboxJobData } from '../../../shared/infrastructure/outbox/outbox.relay'
import type { OnOrderExpiredCommand } from '../application/commands/on-order-expired.command'
import type { ProcessWebhookEventCommand } from '../application/commands/process-webhook-event.command'
import { OutboxEventsProcessor } from './outbox-events.processor'
import { PaymentWebhooksProcessor } from './payment-webhooks.processor'
import { WEBHOOK_PROCESS_JOB, type WebhookJobData } from './payment-webhooks.queue'
import type { PrismaWebhookEventRepository } from './prisma-webhook-event.repository'

/** Cola falsa: `getJobCounts` contesta (Redis arriba) salvo que se pida lo contrario. */
function fakeQueue(answers = true) {
  return {
    on: vi.fn(),
    getJobCounts: vi.fn(() => (answers ? Promise.resolve({}) : new Promise(() => undefined))),
  }
}

function webhooksProcessor(execute: () => Promise<void>) {
  const process = { execute: vi.fn(execute) }
  const events = { recordFailure: vi.fn(() => Promise.resolve()) }
  const processor = new PaymentWebhooksProcessor(
    process as unknown as ProcessWebhookEventCommand,
    events as unknown as PrismaWebhookEventRepository,
    fakeQueue() as unknown as Queue<WebhookJobData>,
  )
  return { events, process, processor }
}

function outboxProcessor(execute: () => Promise<void> = () => Promise.resolve()) {
  const onExpired = { execute: vi.fn(execute) }
  const queue = fakeQueue()
  const processor = new OutboxEventsProcessor(
    onExpired as unknown as OnOrderExpiredCommand,
    queue as unknown as Queue<OutboxJobData>,
  )
  return { onExpired, processor, queue }
}

function job<T>(name: string, data: unknown): Job<T> {
  return { id: 'j1', name, data } as Job<T>
}

describe('PaymentWebhooksProcessor', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('procesa el evento del job webhook.process', async () => {
    const { process, processor } = webhooksProcessor(() => Promise.resolve())

    await processor.process(job(WEBHOOK_PROCESS_JOB, { eventId: 'e1' }))

    expect(process.execute).toHaveBeenCalledWith('e1')
  })

  it('si falla anota el intento y el error en el evento y relanza (BullMQ reintenta)', async () => {
    const { events, processor } = webhooksProcessor(() =>
      Promise.reject(new Error('Mercado Pago no respondió')),
    )

    await expect(processor.process(job(WEBHOOK_PROCESS_JOB, { eventId: 'e1' }))).rejects.toThrow(
      'Mercado Pago no respondió',
    )
    expect(events.recordFailure).toHaveBeenCalledWith('e1', 'Mercado Pago no respondió')
  })

  it('un job sin id de evento falla; otro nombre de job se ignora', async () => {
    const { process, processor } = webhooksProcessor(() => Promise.resolve())

    await expect(processor.process(job(WEBHOOK_PROCESS_JOB, {}))).rejects.toThrow(
      'no trae el id de la notificación',
    )
    await processor.process(job('otro.job', { eventId: 'e1' }))
    expect(process.execute).not.toHaveBeenCalled()
  })

  it('al cerrar con Redis caído cierra el worker forzado; sin worker no hace nada', async () => {
    vi.useFakeTimers()
    const process = { execute: vi.fn() }
    const processor = new PaymentWebhooksProcessor(
      process as unknown as ProcessWebhookEventCommand,
      { recordFailure: vi.fn() } as unknown as PrismaWebhookEventRepository,
      fakeQueue(false) as unknown as Queue<WebhookJobData>,
    )
    await processor.onModuleDestroy()
    const worker = { close: vi.fn(() => Promise.resolve()) }
    Reflect.set(processor, '_worker', worker)

    const closing = processor.onModuleDestroy()
    await vi.advanceTimersByTimeAsync(1_000)
    await closing

    expect(worker.close).toHaveBeenCalledWith(true)
  })
})

describe('OutboxEventsProcessor', () => {
  afterEach(() => {
    vi.restoreAllMocks()
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

  it('avisa (una vez por minuto) cuando falla un job', () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const { processor, queue } = outboxProcessor()

    processor.onFailed(job('order.expired', {}), new Error('Postgres caído'))
    processor.onFailed(undefined, new Error('otra vez'))

    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]?.[0])).toContain('order.expired')
    expect(queue.on).toHaveBeenCalledWith('error', expect.any(Function))
  })
})
