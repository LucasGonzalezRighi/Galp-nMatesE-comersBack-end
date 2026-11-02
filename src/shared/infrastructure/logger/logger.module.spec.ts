import { describe, expect, it } from 'vitest'

import type { Env } from '../../../config/env'
import { buildPinoHttpOptions } from './logger.module'

const BASE: Env = {
  NODE_ENV: 'production',
  PORT: 3001,
  DATABASE_URL: 'postgresql://galpon:galpon@localhost:5432/galpon',
  REDIS_URL: 'redis://localhost:6379',
  ADMIN_ORIGIN: 'http://localhost:5173',
  STORE_ORIGIN: 'http://localhost:3000',
  LOG_LEVEL: 'warn',
}

describe('buildPinoHttpOptions', () => {
  it('usa LOG_LEVEL y no agrega transporte fuera de desarrollo', () => {
    const options = buildPinoHttpOptions(BASE)
    expect(options.level).toBe('warn')
    expect(options.transport).toBeUndefined()
  })

  it('en test no loguea nada', () => {
    expect(buildPinoHttpOptions({ ...BASE, NODE_ENV: 'test' }).level).toBe('silent')
  })

  it('enmascara cookies y la cabecera Authorization', () => {
    expect(buildPinoHttpOptions(BASE).redact).toEqual([
      'req.headers.cookie',
      'req.headers.authorization',
      'res.headers["set-cookie"]',
    ])
  })
})
