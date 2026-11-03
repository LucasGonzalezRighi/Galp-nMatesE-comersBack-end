import { Logger } from '@nestjs/common'
import { type Job, type Queue, UnrecoverableError } from 'bullmq'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { StorefrontRevalidation } from '../application/ports/storefront.port'
import type { StorefrontRevalidateJobData } from './storefront-revalidate.queue'
import { StorefrontRevalidateProcessor } from './storefront-revalidate.processor'

function processorWith(revalidate: () => Promise<StorefrontRevalidation>) {
  const port = { revalidate: vi.fn(revalidate) }
  const queue = { on: vi.fn(), getJobCounts: vi.fn(() => Promise.resolve({})) }
  const processor = new StorefrontRevalidateProcessor(
    port,
    queue as unknown as Queue<StorefrontRevalidateJobData>,
  )
  return { port, processor, queue }
}

function job(
  data: StorefrontRevalidateJobData = {
    eventId: 'e1',
    eventType: 'combo.changed',
    tags: ['combos'],
  },
): Job<StorefrontRevalidateJobData> {
  return {
    id: data.eventId,
    name: 'storefront.revalidate',
    data,
  } as Job<StorefrontRevalidateJobData>
}

describe('StorefrontRevalidateProcessor', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('le pide a la tienda las etiquetas del job y loguea que regeneró', async () => {
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
    const { port, processor } = processorWith(() =>
      Promise.resolve({ kind: 'revalidated', tags: ['combos'] }),
    )

    await processor.process(job())

    expect(port.revalidate).toHaveBeenCalledWith(['combos'])
    expect(String(log.mock.calls[0]?.[0])).toBe('La tienda regeneró combos (evento combo.changed)')
  })

  it('un rechazo de la tienda falla sin reintentos (UnrecoverableError)', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const { processor } = processorWith(() =>
      Promise.resolve({
        kind: 'rejected',
        status: 401,
        reason: 'El secreto de revalidación no es válido.',
      }),
    )

    const error = await processor.process(job()).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(UnrecoverableError)
    expect((error as Error).message).toContain('El secreto de revalidación no es válido.')
    // El aviso sale una vez: el evento `failed` de ese mismo job no lo repite.
    processor.onFailed(job(), error as Error)
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('si el puerto lanza, relanza (BullMQ reintenta)', async () => {
    const { processor } = processorWith(() => Promise.reject(new Error('La tienda respondió 503.')))

    const error = await processor.process(job()).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(Error)
    expect(error).not.toBeInstanceOf(UnrecoverableError)
  })

  it('avisa (una vez por minuto) cuando falla un job', () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const { processor, queue } = processorWith(() =>
      Promise.resolve({ kind: 'revalidated', tags: [] }),
    )

    processor.onFailed(job(), new Error('La tienda respondió 503.'))
    processor.onFailed(undefined, new Error('otra vez'))

    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]?.[0])).toContain('combo.changed')
    expect(queue.on).toHaveBeenCalledWith('error', expect.any(Function))
  })

  it('sin app.init() no hay worker y el cierre no hace nada', async () => {
    const { processor } = processorWith(() => Promise.resolve({ kind: 'revalidated', tags: [] }))

    await expect(processor.onModuleDestroy()).resolves.toBeUndefined()
  })
})
