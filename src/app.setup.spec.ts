import { Controller, Get, type INestApplication, Req } from '@nestjs/common'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { Test } from '@nestjs/testing'
import type { Server } from 'node:http'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { APP_OPTIONS, buildCorsOptions, setupApp, setupBodyParsers } from './app.setup'
import { ConfigModule } from './config/config.module'
import { CLIENT_IP_HEADER, PROXY_SECRET_HEADER } from './shared/infrastructure/http/trusted-proxy'
import { LoggerModule } from './shared/infrastructure/logger/logger.module'

/** Ruta mínima para probar las cabeceras que agrega `setupApp`. */
@Controller('ping')
class PingController {
  @Get()
  ping(): { ok: boolean } {
    return { ok: true }
  }

  /** Devuelve lo que dejó `cookie-parser` en `req.cookies`. */
  @Get('cookies')
  cookies(@Req() req: { cookies?: unknown }): { cookies: unknown } {
    return { cookies: req.cookies }
  }

  /** Devuelve `req.ip` y las cabeceras `x-galpon-*` que le llegaron al controlador. */
  @Get('ip')
  ip(@Req() req: { ip?: string; headers: Record<string, unknown> }): {
    ip: string | null
    proxyHeaders: string[]
  } {
    return {
      ip: req.ip ?? null,
      proxyHeaders: Object.keys(req.headers).filter((name) => name.startsWith('x-galpon-')),
    }
  }
}

const ADMIN_ORIGIN = 'http://localhost:5173'

/** `TRUSTED_PROXY_SECRET` de la app de prueba (40 caracteres, de mentira). */
const PROXY_SECRET = 'secreto-compartido-con-la-tienda-0123456'

describe('buildCorsOptions', () => {
  it('habilita solo el origen del admin, con credenciales', () => {
    expect(buildCorsOptions({ ADMIN_ORIGIN })).toEqual({
      origin: [ADMIN_ORIGIN],
      credentials: true,
      exposedHeaders: ['Retry-After'],
    })
  })

  it('normaliza el origen (sin barra final ni ruta)', () => {
    expect(buildCorsOptions({ ADMIN_ORIGIN: 'http://localhost:5173/admin/' }).origin).toEqual([
      ADMIN_ORIGIN,
    ])
  })
})

describe('setupBodyParsers (NV-17)', () => {
  function parsersFor(env: Parameters<typeof setupBodyParsers>[1]): unknown[][] {
    const useBodyParser = vi.fn()
    setupBodyParsers({ useBodyParser }, env)
    return useBodyParser.mock.calls
  }

  it('en producción solo JSON: hasta 100 kB y sin cuerpos comprimidos', () => {
    expect(parsersFor({ MP_MODE: 'live', NODE_ENV: 'production' })).toEqual([
      ['json', { limit: '100kb', inflate: false }],
    ])
    expect(parsersFor({ MP_MODE: 'live', NODE_ENV: 'development' })).toHaveLength(1)
  })

  it('con el simulador de pagos, además formularios planos, chicos y sin comprimir', () => {
    expect(parsersFor({ MP_MODE: 'simulated', NODE_ENV: 'test' })).toEqual([
      ['json', { limit: '100kb', inflate: false }],
      ['urlencoded', { extended: false, inflate: false, limit: '8kb', parameterLimit: 10 }],
    ])
  })

  it('la app se crea sin los body parsers por defecto de Nest', () => {
    expect(APP_OPTIONS).toEqual({ bodyParser: false })
  })
})

describe('setupApp (CORS, sin base ni Redis)', () => {
  let app: INestApplication<Server> | undefined

  beforeAll(async () => {
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('DATABASE_URL', 'postgresql://galpon:galpon@127.0.0.1:1/galpon')
    vi.stubEnv('REDIS_URL', 'redis://127.0.0.1:1')
    vi.stubEnv('ADMIN_ORIGIN', ADMIN_ORIGIN)
    vi.stubEnv('TRUSTED_PROXY_SECRET', PROXY_SECRET)
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, LoggerModule],
      controllers: [PingController],
    }).compile()
    const created = moduleRef.createNestApplication<NestExpressApplication>(APP_OPTIONS)
    setupApp(created)
    await created.init()
    app = created
  })

  afterAll(async () => {
    await app?.close()
    vi.unstubAllEnvs()
  })

  /** La app ya armada (falla claro si `beforeAll` no llegó a crearla). */
  function server(): Server {
    if (!app) throw new Error('La app de prueba no se creó')
    return app.getHttpServer()
  }

  it('responde el preflight del admin (5173) con permiso y credenciales', async () => {
    const response = await request(server())
      .options('/api/v1/ping')
      .set('Origin', ADMIN_ORIGIN)
      .set('Access-Control-Request-Method', 'POST')

    expect(response.status).toBe(204)
    expect(response.headers['access-control-allow-origin']).toBe(ADMIN_ORIGIN)
    expect(response.headers['access-control-allow-credentials']).toBe('true')
  })

  it('expone Retry-After al admin, para que lea la espera de un 429', async () => {
    const response = await request(server()).get('/api/v1/ping').set('Origin', ADMIN_ORIGIN)

    expect(response.status).toBe(200)
    expect(response.headers['access-control-expose-headers']).toBe('Retry-After')
  })

  it('parsea las cookies del pedido (cookie-parser) para los guards de sesión', async () => {
    const response = await request(server())
      .get('/api/v1/ping/cookies')
      .set('Cookie', '__Host-galpon_session=abc123; otra=1')

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ cookies: { '__Host-galpon_session': 'abc123', otra: '1' } })
  })

  it('con TRUSTED_PROXY_SECRET, req.ip es la IP que manda la tienda y sus cabeceras no llegan al controlador', async () => {
    const fromStore = await request(server())
      .get('/api/v1/ping/ip')
      .set(PROXY_SECRET_HEADER, PROXY_SECRET)
      .set(CLIENT_IP_HEADER, '203.0.113.7')
    const direct = await request(server())
      .get('/api/v1/ping/ip')
      .set(PROXY_SECRET_HEADER, 'otro-secreto-que-no-es-el-de-la-tienda-99')
      .set(CLIENT_IP_HEADER, '203.0.113.7')

    expect(fromStore.body).toEqual({ ip: '203.0.113.7', proxyHeaders: [] })
    expect((direct.body as { ip: string }).ip).toMatch(/127\.0\.0\.1$/)
    expect((direct.body as { proxyHeaders: string[] }).proxyHeaders).toEqual([])
  })

  it('no agrega cabeceras CORS para otro origen (la tienda en 3000)', async () => {
    const response = await request(server())
      .get('/api/v1/ping')
      .set('Origin', 'http://localhost:3000')

    expect(response.status).toBe(200)
    expect(response.headers['access-control-allow-origin']).toBeUndefined()
  })
})
