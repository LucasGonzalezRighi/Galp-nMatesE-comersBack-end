import { Controller, Get, Req } from '@nestjs/common'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { applyTrustProxy, type ClientIpRequest, knownClientIp } from './client-ip'
import {
  CLIENT_IP_FROM_FORWARDED_FOR,
  CLIENT_IP_FROM_HEADER,
  CLIENT_IP_HEADER,
  PROXY_SECRET_HEADER,
  trustedProxyMiddleware,
} from './trusted-proxy'

/** Lo que ve el back de un pedido. */
interface Seen {
  /** `req.ip`. */
  ip: string | null
  /** La IP real que se conoce (`knownClientIp`). */
  known: string | null
  /** Nombres de las cabeceras `x-galpon-*` que le llegaron al controlador. */
  proxyHeaders: string[]
}

/** Devuelve lo que ve el back del pedido: `req.ip` y la IP real que se conoce. */
@Controller('ip')
class IpController {
  /** @returns `req.ip`, `knownClientIp(req)` y las cabeceras `x-galpon-*` que llegaron. */
  @Get()
  ip(@Req() req: ClientIpRequest & { headers: Record<string, unknown> }): Seen {
    return {
      ip: req.ip ?? null,
      known: knownClientIp(req),
      proxyHeaders: Object.keys(req.headers).filter((name) => name.startsWith('x-galpon-')),
    }
  }
}

/** Secreto compartido de mentira (40 caracteres). */
const SECRET = 'secreto-compartido-con-la-tienda-0123456'

/**
 * Arma la app como `setupApp`: `trust proxy` y el middleware del secreto compartido, que sin
 * `secret` (`TRUSTED_PROXY_SECRET` sin configurar) solo borra sus cabeceras.
 */
async function appTrusting(
  trustProxy: readonly string[],
  secret?: string,
): Promise<NestExpressApplication> {
  const moduleRef = await Test.createTestingModule({ controllers: [IpController] }).compile()
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false })
  applyTrustProxy(app, trustProxy)
  app.use(trustedProxyMiddleware(secret))
  await app.init()
  return app
}

/** Pide `GET /ip` con esas cabeceras y devuelve lo que vio el back. */
async function seenBy(
  app: NestExpressApplication | undefined,
  headers: Record<string, string> = {},
): Promise<Seen> {
  if (app === undefined) throw new Error('La app no arrancó')
  let pending = request(app.getHttpServer()).get('/ip')
  for (const [name, value] of Object.entries(headers)) pending = pending.set(name, value)
  return (await pending).body as Seen
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
    return seenBy(
      apps[index],
      forwardedFor === undefined ? {} : { 'X-Forwarded-For': forwardedFor },
    )
  }

  it('sin TRUST_PROXY ignora X-Forwarded-For y no conoce la IP real', async () => {
    const response = await seen(0, '203.0.113.5')

    expect(response.ip).toMatch(/127\.0\.0\.1$/)
    expect(response.known).toBeNull()
  })

  it('con TRUST_PROXY toma la IP del cliente de X-Forwarded-For', async () => {
    expect(await seen(1, '203.0.113.5')).toMatchObject({ ip: '203.0.113.5', known: '203.0.113.5' })
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

describe('IP del cliente autenticada con el secreto compartido (TRUSTED_PROXY_SECRET)', () => {
  let withoutSecret: NestExpressApplication | undefined
  let withSecret: NestExpressApplication | undefined
  let withSecretAndTrust: NestExpressApplication | undefined

  beforeAll(async () => {
    withoutSecret = await appTrusting([])
    withSecret = await appTrusting([], SECRET)
    withSecretAndTrust = await appTrusting(['loopback'], SECRET)
  })

  afterAll(async () => {
    await withoutSecret?.close()
    await withSecret?.close()
    await withSecretAndTrust?.close()
  })

  /** Las cabeceras de un pedido que reenvía la tienda por ese cliente. */
  function fromStore(clientIp: string, secret = SECRET): Record<string, string> {
    return { [PROXY_SECRET_HEADER]: secret, [CLIENT_IP_HEADER]: clientIp }
  }

  it('sin el secreto configurado todo sigue como hoy, y las tres cabeceras no llegan al controlador', async () => {
    const response = await seenBy(withoutSecret, {
      ...fromStore('203.0.113.7'),
      [CLIENT_IP_FROM_HEADER]: CLIENT_IP_FROM_FORWARDED_FOR,
      'X-Forwarded-For': '203.0.113.5',
    })

    expect(response.ip).toMatch(/127\.0\.0\.1$/)
    expect(response.known).toBeNull()
    expect(response.proxyHeaders).toEqual([])
  })

  it('con el secreto correcto, req.ip y la IP conocida son las de x-galpon-client-ip', async () => {
    expect(await seenBy(withSecret, fromStore('203.0.113.7'))).toEqual({
      ip: '203.0.113.7',
      known: '203.0.113.7',
      proxyHeaders: [],
    })
    expect(await seenBy(withSecret, fromStore('2001:db8:1:2::9'))).toMatchObject({
      ip: '2001:db8:1:2::9',
      known: '2001:db8:1:2::9',
    })
  })

  it('X-Forwarded-For no cambia la IP que mandó la tienda', async () => {
    const response = await seenBy(withSecret, {
      ...fromStore('203.0.113.7'),
      'X-Forwarded-For': '192.0.2.66',
    })

    expect(response).toMatchObject({ ip: '203.0.113.7', known: '203.0.113.7' })
  })

  it('con -from: x-forwarded-for gana la primera IP de X-Forwarded-For, aunque venga x-galpon-client-ip', async () => {
    const response = await seenBy(withSecret, {
      ...fromStore('192.0.2.66'),
      [CLIENT_IP_FROM_HEADER]: CLIENT_IP_FROM_FORWARDED_FOR,
      'X-Forwarded-For': '203.0.113.9, 10.0.0.1',
    })

    expect(response).toEqual({ ip: '203.0.113.9', known: '203.0.113.9', proxyHeaders: [] })
  })

  it('con -from: x-forwarded-for y sin una primera IP válida no hay cliente (no se usa x-galpon-client-ip)', async () => {
    const response = await seenBy(withSecret, {
      ...fromStore('192.0.2.66'),
      [CLIENT_IP_FROM_HEADER]: CLIENT_IP_FROM_FORWARDED_FOR,
    })

    expect(response.ip).toMatch(/127\.0\.0\.1$/)
    expect(response.known).toBeNull()
  })

  it('el servidor de la tienda (secreto, sin cliente) no tiene IP de cliente conocida', async () => {
    const response = await seenBy(withSecret, { [PROXY_SECRET_HEADER]: SECRET })

    expect(response.ip).toMatch(/127\.0\.0\.1$/)
    expect(response.known).toBeNull()
    expect(response.proxyHeaders).toEqual([])
  })

  it('con el secreto equivocado el pedido es directo: cuenta por la IP del socket y las cabeceras se borran', async () => {
    const wrong = await seenBy(withSecret, {
      ...fromStore('203.0.113.7', `${SECRET.slice(0, -1)}7`),
      'X-Forwarded-For': '192.0.2.66',
    })
    const plain = await seenBy(withSecret)

    expect(wrong.ip).toMatch(/127\.0\.0\.1$/)
    expect(wrong.known).toBe(wrong.ip)
    expect(wrong.proxyHeaders).toEqual([])
    expect(plain.known).toBe(plain.ip)
  })

  it('con el secreto y TRUST_PROXY a la vez: un pedido directo vale lo que diga Express y la tienda sigue mandando', async () => {
    const direct = await seenBy(withSecretAndTrust, { 'X-Forwarded-For': '203.0.113.5' })
    const store = await seenBy(withSecretAndTrust, {
      ...fromStore('203.0.113.7'),
      'X-Forwarded-For': '203.0.113.5',
    })

    expect(direct).toMatchObject({ ip: '203.0.113.5', known: '203.0.113.5' })
    expect(store).toMatchObject({ ip: '203.0.113.7', known: '203.0.113.7' })
  })
})
