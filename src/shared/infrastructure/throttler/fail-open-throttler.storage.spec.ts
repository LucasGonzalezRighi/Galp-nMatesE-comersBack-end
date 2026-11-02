import type { ThrottlerStorage } from '@nestjs/throttler'
import { describe, expect, it, vi } from 'vitest'

import { FailOpenThrottlerStorage } from './fail-open-throttler.storage'

const PRIMARY_RECORD = { totalHits: 3, timeToExpire: 50, isBlocked: false, timeToBlockExpire: 0 }
const FALLBACK_RECORD = { totalHits: 1, timeToExpire: 60, isBlocked: false, timeToBlockExpire: 0 }

function fallbackStorage() {
  const increment = vi.fn(() => Promise.resolve(FALLBACK_RECORD))
  const onApplicationShutdown = vi.fn()
  return { storage: { increment, onApplicationShutdown }, increment, onApplicationShutdown }
}

function fakeLogger() {
  return { warn: vi.fn<(message: string) => void>() }
}

describe('FailOpenThrottlerStorage', () => {
  it('con Redis funcionando usa el almacenamiento principal', async () => {
    const increment = vi.fn(() => Promise.resolve(PRIMARY_RECORD))
    const fallback = fallbackStorage()
    const storage = new FailOpenThrottlerStorage({ increment }, fallback.storage, fakeLogger())

    await expect(storage.increment('ip', 60_000, 120, 60_000, 'default')).resolves.toEqual(
      PRIMARY_RECORD,
    )
    expect(increment).toHaveBeenCalledWith('ip', 60_000, 120, 60_000, 'default')
    expect(fallback.increment).not.toHaveBeenCalled()
  })

  it('con Redis caído no lanza: cuenta en memoria y loguea un warn por minuto', async () => {
    let now = 0
    const primary: ThrottlerStorage = {
      increment: () => Promise.reject(new Error('Connection is closed.')),
    }
    const fallback = fallbackStorage()
    const logger = fakeLogger()
    const storage = new FailOpenThrottlerStorage(primary, fallback.storage, logger, () => now)

    await expect(storage.increment('ip', 60_000, 120, 60_000, 'default')).resolves.toEqual(
      FALLBACK_RECORD,
    )
    await storage.increment('ip', 60_000, 120, 60_000, 'default')
    expect(fallback.increment).toHaveBeenCalledTimes(2)
    expect(logger.warn).toHaveBeenCalledTimes(1)

    now += 60_000
    await storage.increment('ip', 60_000, 120, 60_000, 'default')
    expect(logger.warn).toHaveBeenCalledTimes(2)
  })

  it('al apagar la app libera los temporizadores del almacenamiento en memoria', () => {
    const fallback = fallbackStorage()
    const storage = new FailOpenThrottlerStorage(
      { increment: vi.fn() },
      fallback.storage,
      fakeLogger(),
    )

    storage.onApplicationShutdown()

    expect(fallback.onApplicationShutdown).toHaveBeenCalledTimes(1)
  })
})
