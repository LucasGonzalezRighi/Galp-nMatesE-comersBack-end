import { describe, expect, it } from 'vitest'

import { parseEnv } from '../../../config/env'
import { buildPoolConfig, PrismaService } from './prisma.service'

/** Postgres inexistente: el puerto 1 rechaza la conexión al instante, sin red ni Docker. */
const unreachableEnv = parseEnv({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://galpon:clave-secreta@127.0.0.1:1/galpon',
  REDIS_URL: 'redis://127.0.0.1:1',
})

describe('buildPoolConfig', () => {
  it('pone tope a la espera de una conexión y a cada consulta (B8)', () => {
    expect(buildPoolConfig('postgresql://galpon:clave@db:5432/galpon')).toEqual({
      connectionString: 'postgresql://galpon:clave@db:5432/galpon',
      connectionTimeoutMillis: 10_000,
      statement_timeout: 30_000,
    })
  })
})

describe('PrismaService', () => {
  it('onModuleInit falla en español si Postgres no responde, sin exponer la URL ni la clave', async () => {
    const prisma = new PrismaService(unreachableEnv)

    const error = await prisma.onModuleInit().then(
      () => undefined,
      (reason: unknown) => reason,
    )
    await prisma.onModuleDestroy()

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toMatch(/Postgres/)
    expect((error as Error).message).not.toContain('clave-secreta')
  })
})
