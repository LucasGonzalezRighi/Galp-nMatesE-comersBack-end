import { Logger } from '@nestjs/common'
import type { Queue } from 'bullmq'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { BullWebhookQueue } from './bull-webhook-queue.adapter'
import {
  WEBHOOK_JOB_OPTIONS,
  WEBHOOK_PROCESS_JOB,
  type WebhookJobData,
} from './payment-webhooks.queue'

function queueWith(add: () => Promise<unknown>) {
  const queue = { add: vi.fn(add), on: vi.fn() }
  return { adapter: new BullWebhookQueue(queue as unknown as Queue<WebhookJobData>), queue }
}

describe('BullWebhookQueue', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('encola webhook.process con jobId = id del evento, 5 intentos y backoff exponencial', async () => {
    const { adapter, queue } = queueWith(() => Promise.resolve({}))

    await expect(adapter.enqueue('evento-1')).resolves.toBe(true)
    expect(queue.add).toHaveBeenCalledWith(
      WEBHOOK_PROCESS_JOB,
      { eventId: 'evento-1' },
      { ...WEBHOOK_JOB_OPTIONS, jobId: 'evento-1' },
    )
    expect(WEBHOOK_PROCESS_JOB).toBe('webhook.process')
    expect(WEBHOOK_JOB_OPTIONS).toMatchObject({
      attempts: 5,
      backoff: { type: 'exponential', delay: 1_000 },
    })
  })

  it('falla abierta: con Redis caído avisa y devuelve false sin lanzar', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const { adapter } = queueWith(() =>
      Promise.reject(new Error("Stream isn't writeable and enableOfflineQueue options is false")),
    )

    await expect(adapter.enqueue('evento-2')).resolves.toBe(false)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('evento-2'))
  })

  it('un id vacío no se encola', async () => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const { adapter, queue } = queueWith(() => Promise.resolve({}))

    await expect(adapter.enqueue('')).resolves.toBe(false)
    expect(queue.add).not.toHaveBeenCalled()
  })

  it('escucha los errores de conexión de la cola (si no, Node los tira como excepción)', () => {
    const { queue } = queueWith(() => Promise.resolve({}))

    expect(queue.on).toHaveBeenCalledWith('error', expect.any(Function))
  })
})
