import { Controller, Get, type INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import type { Server } from 'node:http'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { buildCorsOptions, setupApp } from './app.setup'
import { ConfigModule } from './config/config.module'
import { LoggerModule } from './shared/infrastructure/logger/logger.module'

/** Ruta mínima para probar las cabeceras que agrega `setupApp`. */
@Controller('ping')
class PingController {
  @Get()
  ping(): { ok: boolean } {
    return { ok: true }
  }
}

const ADMIN_ORIGIN = 'http://localhost:5173'

describe('buildCorsOptions', () => {
  it('habilita solo el origen del admin, con credenciales', () => {
    expect(buildCorsOptions({ ADMIN_ORIGIN })).toEqual({
      origin: [ADMIN_ORIGIN],
      credentials: true,
    })
  })

  it('normaliza el origen (sin barra final ni ruta)', () => {
    expect(buildCorsOptions({ ADMIN_ORIGIN: 'http://localhost:5173/admin/' }).origin).toEqual([
      ADMIN_ORIGIN,
    ])
  })
})

describe('setupApp (CORS, sin base ni Redis)', () => {
  let app: INestApplication<Server> | undefined

  beforeAll(async () => {
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('DATABASE_URL', 'postgresql://galpon:galpon@127.0.0.1:1/galpon')
    vi.stubEnv('REDIS_URL', 'redis://127.0.0.1:1')
    vi.stubEnv('ADMIN_ORIGIN', ADMIN_ORIGIN)
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, LoggerModule],
      controllers: [PingController],
    }).compile()
    app = moduleRef.createNestApplication<INestApplication<Server>>()
    setupApp(app)
    await app.init()
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

  it('no agrega cabeceras CORS para otro origen (la tienda en 3000)', async () => {
    const response = await request(server())
      .get('/api/v1/ping')
      .set('Origin', 'http://localhost:3000')

    expect(response.status).toBe(200)
    expect(response.headers['access-control-allow-origin']).toBeUndefined()
  })
})
