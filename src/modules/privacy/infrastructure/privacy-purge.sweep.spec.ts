import { Logger } from '@nestjs/common'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Env } from '../../../config/env'
import type {
  PurgeExpiredDataCommand,
  PurgeSummary,
} from '../application/purge-expired-data.command'
import {
  PRIVACY_PURGE_FIRST_RUN_MS,
  PRIVACY_PURGE_INTERVAL_MS,
  PrivacyPurgeSweep,
  purgeSummaryMessage,
} from './privacy-purge.sweep'

const NOW = new Date('2026-11-17T12:00:00.000Z')
const SUMMARY: PurgeSummary = {
  idempotencyKeys: 1,
  passwordResetTokens: 2,
  contactMessages: 3,
  webhookEvents: 4,
  outboxEvents: 5,
  reviews: 6,
}

function sweepWith(execute: () => Promise<PurgeSummary>, nodeEnv: Env['NODE_ENV']) {
  const purge = { execute: vi.fn(execute) }
  const sweep = new PrivacyPurgeSweep(
    purge as unknown as PurgeExpiredDataCommand,
    { now: () => NOW },
    { NODE_ENV: nodeEnv } as Env,
  )
  return { purge, sweep }
}

describe('PrivacyPurgeSweep', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('con NODE_ENV=test no arranca', async () => {
    vi.useFakeTimers()
    const { purge, sweep } = sweepWith(() => Promise.resolve(SUMMARY), 'test')

    sweep.onModuleInit()
    await vi.advanceTimersByTimeAsync(2 * PRIVACY_PURGE_INTERVAL_MS)

    expect(purge.execute).not.toHaveBeenCalled()
    await sweep.onModuleDestroy()
  })

  it('fuera de test corre al rato de arrancar y después una vez por día', async () => {
    vi.useFakeTimers()
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
    const { purge, sweep } = sweepWith(() => Promise.resolve(SUMMARY), 'production')

    sweep.onModuleInit()
    await vi.advanceTimersByTimeAsync(PRIVACY_PURGE_FIRST_RUN_MS)
    expect(purge.execute).toHaveBeenCalledTimes(1)
    expect(purge.execute).toHaveBeenCalledWith(NOW)
    await vi.advanceTimersByTimeAsync(PRIVACY_PURGE_INTERVAL_MS)
    expect(purge.execute).toHaveBeenCalledTimes(2)
    await sweep.onModuleDestroy()
    await vi.advanceTimersByTimeAsync(2 * PRIVACY_PURGE_INTERVAL_MS)

    expect(purge.execute).toHaveBeenCalledTimes(2)
    expect(log).toHaveBeenCalledWith(purgeSummaryMessage(SUMMARY))
  })

  it('loguea solo cantidades', () => {
    expect(purgeSummaryMessage(SUMMARY)).toBe(
      'Purga de datos personales: 1 claves de idempotencia, 2 tokens de contraseña, ' +
        '3 mensajes de contacto, 4 eventos de webhook, 5 eventos del outbox y 6 reseñas',
    )
  })

  it('si la purga falla avisa y devuelve undefined, sin lanzar', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const { sweep } = sweepWith(() => Promise.reject(new Error('Postgres caído')), 'test')

    await expect(sweep.runOnce()).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledWith(
      'No se pudo purgar los datos personales vencidos: Postgres caído',
    )
  })
})
