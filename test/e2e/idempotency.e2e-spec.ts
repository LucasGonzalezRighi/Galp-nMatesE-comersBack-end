import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { randomUUID } from 'node:crypto'
import type { Server } from 'node:http'
import { setTimeout as sleep } from 'node:timers/promises'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { AppModule } from '../../src/app.module'
import { setupApp } from '../../src/app.setup'
import { PrismaService } from '../../src/shared/infrastructure/prisma/prisma.service'
import { startContainers, type TestContainers } from '../support/containers'
import { testOnlyControllers } from '../support/idempotency.controller'

const ROUTE = '/api/v1/_test/idempotent'
const PROBLEM_JSON = /^application\/problem\+json/

describe('idempotencia y problem+json (E2E)', () => {
  let containers: TestContainers | undefined
  let app: INestApplication<Server> | undefined
  const previousEnv = { DATABASE_URL: process.env.DATABASE_URL, REDIS_URL: process.env.REDIS_URL }

  beforeAll(async () => {
    containers = await startContainers()
    process.env.DATABASE_URL = containers.databaseUrl
    process.env.REDIS_URL = containers.redisUrl
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: testOnlyControllers(),
    }).compile()
    app = moduleRef.createNestApplication<INestApplication<Server>>()
    setupApp(app)
    await app.init()
  })

  afterAll(async () => {
    await app?.close()
    await containers?.stop()
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) Reflect.deleteProperty(process.env, key)
      else process.env[key] = value
    }
  })

  function server(): Server {
    if (app === undefined) throw new Error('La app no arrancó')
    return app.getHttpServer()
  }

  function post(key: string | undefined, body: object): request.Test {
    const req = request(server()).post(ROUTE)
    return key === undefined ? req.send(body) : req.set('Idempotency-Key', key).send(body)
  }

  it('sin Idempotency-Key responde 422 problem+json', async () => {
    const res = await post(undefined, { note: 'hola' })

    expect(res.status).toBe(422)
    expect(res.headers['content-type']).toMatch(PROBLEM_JSON)
    expect(res.body).toMatchObject({
      type: 'validation_error',
      status: 422,
      instance: ROUTE,
      errors: [{ field: 'Idempotency-Key', code: 'required' }],
    })
  })

  it('con la misma clave y el mismo cuerpo repite la respuesta guardada', async () => {
    const key = randomUUID()
    const first = await post(key, { note: 'pedido' })
    const second = await post(key, { note: 'pedido' })

    expect(first.status).toBe(201)
    expect(second.status).toBe(201)
    expect(second.body).toEqual(first.body)
    expect(second.headers['idempotent-replayed']).toBe('true')
    expect(first.headers['idempotent-replayed']).toBeUndefined()

    const row = await app
      ?.get(PrismaService)
      .idempotencyKey.findUnique({ where: { scope_key: { scope: 'test', key } } })
    expect(row).toMatchObject({ status: 'completed', responseStatus: 201 })
    const ttl = (row?.expiresAt.getTime() ?? 0) - (row?.createdAt.getTime() ?? 0)
    expect(ttl).toBe(24 * 60 * 60 * 1_000)
  })

  it('con la misma clave y otro cuerpo responde 422 idempotency_key_reused', async () => {
    const key = randomUUID()
    await post(key, { note: 'uno' })
    const res = await post(key, { note: 'otro' })

    expect(res.status).toBe(422)
    expect(res.headers['content-type']).toMatch(PROBLEM_JSON)
    expect(res.body).toMatchObject({ type: 'idempotency_key_reused', status: 422 })
  })

  it('con la misma clave mientras se procesa responde 409 idempotency_in_progress', async () => {
    const key = randomUUID()
    const slow = post(key, { note: 'lento', delayMs: 1_000 }).then((res) => res)
    await sleep(300)
    const concurrent = await post(key, { note: 'lento', delayMs: 1_000 })
    const first = await slow

    expect(concurrent.status).toBe(409)
    expect(concurrent.body).toMatchObject({ type: 'idempotency_in_progress', status: 409 })
    expect(first.status).toBe(201)
  })

  it('un cuerpo inválido responde 422 con errors[] y libera la clave', async () => {
    const key = randomUUID()
    const invalid = await post(key, { note: '', extra: 1 })

    expect(invalid.status).toBe(422)
    expect(invalid.body).toMatchObject({
      type: 'validation_error',
      title: 'Los datos no son válidos',
      detail: 'Revisá los campos marcados.',
      // class-validator informa primero los campos que sobran.
      errors: [
        { field: 'extra', code: 'unrecognized_key', message: 'Este campo no está permitido.' },
        { field: 'note', code: 'too_small', message: 'La nota no puede estar vacía.' },
      ],
    })

    const valid = await post(key, { note: 'ahora sí' })
    expect(valid.status).toBe(201)
  })

  it('una ruta que no existe responde 404 problem+json en español', async () => {
    const res = await request(server()).get('/api/v1/no-existe?x=1')

    expect(res.status).toBe(404)
    expect(res.headers['content-type']).toMatch(PROBLEM_JSON)
    expect(res.body).toEqual({
      type: 'not_found',
      title: 'No encontrado',
      status: 404,
      detail: 'No existe la ruta GET /api/v1/no-existe.',
      instance: '/api/v1/no-existe',
    })
  })
})
