import { HealthIndicatorService } from '@nestjs/terminus'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { parseEnv } from '../../../config/env'
import { PrismaHealthIndicator } from './prisma.health'
import { PrismaService } from './prisma.service'

const env = parseEnv({
  DATABASE_URL: 'postgresql://galpon:clave-secreta@127.0.0.1:1/galpon',
  REDIS_URL: 'redis://127.0.0.1:1',
})

describe('PrismaHealthIndicator', () => {
  const prisma = new PrismaService(env)
  const indicator = new PrismaHealthIndicator(prisma, new HealthIndicatorService())

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('con Postgres respondiendo da up', async () => {
    vi.spyOn(prisma, '$queryRaw').mockResolvedValue([{ ok: 1 }])

    await expect(indicator.isHealthy('database')).resolves.toEqual({ database: { status: 'up' } })
  })

  it('con Postgres caído da down con un mensaje genérico que no expone host ni credenciales', async () => {
    vi.spyOn(prisma, '$queryRaw').mockRejectedValue(
      new Error('connect ECONNREFUSED 127.0.0.1:1 (galpon:clave-secreta)'),
    )

    const result = await indicator.isHealthy('database')

    expect(result).toMatchObject({ database: { status: 'down' } })
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain('ECONNREFUSED')
    expect(serialized).not.toContain('127.0.0.1')
    expect(serialized).not.toContain('clave-secreta')
  })
})
