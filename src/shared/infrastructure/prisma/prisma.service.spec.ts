import { describe, expect, it } from 'vitest'

import { parseEnv } from '../../../config/env'
import { PrismaService } from './prisma.service'

/** Postgres inexistente: el puerto 1 rechaza la conexión al instante, sin red ni Docker. */
const unreachableEnv = parseEnv({
  DATABASE_URL: 'postgresql://galpon:clave-secreta@127.0.0.1:1/galpon',
  REDIS_URL: 'redis://127.0.0.1:1',
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
