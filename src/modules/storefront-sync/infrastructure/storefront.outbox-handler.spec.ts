import { Logger } from '@nestjs/common'
import type { Queue } from 'bullmq'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { OutboxHandlerRegistry } from '../../../shared/infrastructure/outbox/outbox-handler.registry'
import type { OutboxJobData } from '../../../shared/infrastructure/outbox/outbox.relay'
import {
  STOREFRONT_REVALIDATE_JOB,
  STOREFRONT_REVALIDATE_JOB_OPTIONS,
  type StorefrontRevalidateJobData,
} from './storefront-revalidate.queue'
import { NO_STORE_SECRET_WARNING, StorefrontOutboxHandler } from './storefront.outbox-handler'

const SECRET = 's'.repeat(32)

function handlerWith(secret: string | undefined, add = () => Promise.resolve({})) {
  const registry = new OutboxHandlerRegistry()
  const queue = { add: vi.fn(add) }
  const handler = new StorefrontOutboxHandler(
    registry,
    queue as unknown as Queue<StorefrontRevalidateJobData>,
    { STORE_REVALIDATE_SECRET: secret },
  )
  return { handler, queue, registry }
}

function comboChanged(id = 'e1'): OutboxJobData {
  return {
    id,
    type: 'combo.changed',
    aggregateType: 'combo',
    aggregateId: 'combos',
    occurredAt: '2026-11-03T12:00:00.000Z',
    payload: { comboId: null, change: 'reordered' },
  }
}

describe('StorefrontOutboxHandler', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('se registra para combo.changed al crearse', () => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const { handler, registry } = handlerWith(SECRET)

    expect(registry.handlersFor('combo.changed')).toEqual([handler])
  })

  it('con secreto encola el aviso con jobId = id del evento y las opciones de la cola', async () => {
    const { handler, queue } = handlerWith(SECRET)

    await handler.handle(comboChanged('e1'))

    expect(queue.add).toHaveBeenCalledWith(
      STOREFRONT_REVALIDATE_JOB,
      { eventId: 'e1', eventType: 'combo.changed', tags: ['combos'] },
      { ...STOREFRONT_REVALIDATE_JOB_OPTIONS, jobId: 'e1' },
    )
    expect(STOREFRONT_REVALIDATE_JOB_OPTIONS).toMatchObject({
      attempts: 8,
      backoff: { type: 'exponential', delay: 1_000 },
    })
  })

  it('sin secreto no encola y avisa una sola vez al arrancar', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const { handler, queue } = handlerWith(undefined)

    await handler.handle(comboChanged('e1'))
    await handler.handle(comboChanged('e2'))

    expect(queue.add).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]?.[0]).toBe(NO_STORE_SECRET_WARNING)
    expect(NO_STORE_SECRET_WARNING).toBe(
      'Sin STORE_REVALIDATE_SECRET la tienda no se entera de los cambios: se regenera por tiempo',
    )
  })

  it('un evento sin etiquetas no encola nada', async () => {
    const { handler, queue } = handlerWith(SECRET)

    await handler.handle({ ...comboChanged(), type: 'order.created' })

    expect(queue.add).not.toHaveBeenCalled()
  })

  it('si Redis no acepta el job, lanza (el outbox reintenta)', async () => {
    const { handler } = handlerWith(SECRET, () => Promise.reject(new Error('Redis caído')))

    await expect(handler.handle(comboChanged())).rejects.toThrow('Redis caído')
  })
})
