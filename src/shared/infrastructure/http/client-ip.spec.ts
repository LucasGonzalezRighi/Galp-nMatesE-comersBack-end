import { Controller, Get, Req } from '@nestjs/common'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { applyTrustProxy, type ClientIpRequest, knownClientIp } from './client-ip'

/** Devuelve lo que ve el back del pedido: `req.ip` y la IP real que se conoce. */
@Controller('ip')
class IpController {
  /** @returns `req.ip` y `knownClientIp(req)`. */
  @Get()
  ip(@Req() req: ClientIpRequest): { ip: string | null; known: string | null } {
    return { ip: req.ip ?? null, known: knownClientIp(req) }
  }
}

async function appTrusting(trustProxy: readonly string[]): Promise<NestExpressApplication> {
  const moduleRef = await Test.createTestingModule({ controllers: [IpController] }).compile()
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false })
  applyTrustProxy(app, trustProxy)
  await app.init()
  return app
}

describe('IP del cliente detrás de proxies de confianza (NV-25)', () => {
  const apps: NestExpressApplication[] = []

  beforeAll(async () => {
    apps.push(await appTrusting([]), await appTrusting(['loopback', '10.0.0.0/8']))
  })

  afterAll(async () => {
    await Promise.all(apps.map((app) => app.close()))
  })

  async function seen(
    index: number,
    forwardedFor?: string,
  ): Promise<{ ip: string | null; known: string | null }> {
    const app = apps[index]
    if (app === undefined) throw new Error('La app no arrancó')
    const pending = request(app.getHttpServer()).get('/ip')
    const response =
      forwardedFor === undefined
        ? await pending
        : await pending.set('X-Forwarded-For', forwardedFor)
    return response.body as { ip: string | null; known: string | null }
  }

  it('sin TRUST_PROXY ignora X-Forwarded-For y no conoce la IP real', async () => {
    const response = await seen(0, '203.0.113.5')

    expect(response.ip).toMatch(/127\.0\.0\.1$/)
    expect(response.known).toBeNull()
  })

  it('con TRUST_PROXY toma la IP del cliente de X-Forwarded-For', async () => {
    expect(await seen(1, '203.0.113.5')).toEqual({ ip: '203.0.113.5', known: '203.0.113.5' })
  })

  it('salta solo los proxies de confianza: la primera IP de afuera desde la derecha', async () => {
    expect((await seen(1, '198.51.100.1, 10.0.0.9')).known).toBe('198.51.100.1')
    // Lo que el cliente inventa a la izquierda no cuenta: manda la que agregó el proxy.
    expect((await seen(1, '192.0.2.66, 203.0.113.5')).known).toBe('203.0.113.5')
  })

  it('un pedido del propio proxy (sin X-Forwarded-For) no tiene IP de cliente conocida', async () => {
    const response = await seen(1)

    expect(response.ip).toMatch(/127\.0\.0\.1$/)
    expect(response.known).toBeNull()
  })
})
