import { Controller, Get, NotFoundException, Post } from '@nestjs/common'
import { APP_INTERCEPTOR } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { PublicRead } from '../throttler/public-read'
import { PrivateCacheInterceptor } from './private-cache.interceptor'
import { ProblemFilter } from './problem.filter'

/** Rutas que dependen de la sesión o de un token. */
@Controller('private')
class PrivateController {
  /** @returns Datos de alguien. */
  @Get()
  read(): object {
    return { email: 'ana@mail.com' }
  }

  /** @throws {NotFoundException} Siempre: el pedido es de otro. */
  @Get('ajeno')
  missing(): never {
    throw new NotFoundException('No encontramos ese pedido.')
  }

  /** @returns Un recibo. */
  @Post()
  write(): object {
    return { ok: true }
  }
}

/** Lectura pública en la clase, con un método que también lo es. */
@PublicRead()
@Controller('public')
class PublicController {
  /** @returns El catálogo. */
  @Get()
  read(): object {
    return { items: [] }
  }
}

describe('PrivateCacheInterceptor (NV-11)', () => {
  let app: NestExpressApplication | undefined

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [PrivateController, PublicController],
      providers: [{ provide: APP_INTERCEPTOR, useClass: PrivateCacheInterceptor }],
    }).compile()
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false })
    app.enableCors({ origin: ['http://localhost:5173'], credentials: true })
    app.useGlobalFilters(new ProblemFilter())
    await app.init()
  })

  afterAll(async () => {
    await app?.close()
  })

  function agent() {
    if (app === undefined) throw new Error('La app no arrancó')
    return request(app.getHttpServer())
  }

  it('una respuesta privada sale con Cache-Control: no-store y Vary: Cookie (sin pisar Origin)', async () => {
    const response = await agent().get('/private').set('Origin', 'http://localhost:5173')

    expect(response.status).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.headers.vary).toBe('Origin, Cookie')
  })

  it('también en los errores del handler y en las escrituras', async () => {
    const missing = await agent().get('/private/ajeno')
    const written = await agent().post('/private')

    expect(missing.status).toBe(404)
    expect(written.status).toBe(201)
    for (const response of [missing, written]) {
      expect(response.headers['cache-control']).toBe('no-store')
      expect(response.headers.vary).toBe('Origin, Cookie')
    }
  })

  it('una lectura pública no cambia: la tienda la cachea', async () => {
    const response = await agent().get('/public')

    expect(response.status).toBe(200)
    expect(response.headers['cache-control']).toBeUndefined()
    expect(response.headers.vary).toBe('Origin')
  })
})
