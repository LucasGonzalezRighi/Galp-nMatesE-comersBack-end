import type { INestApplication } from '@nestjs/common'
import { Redis } from 'ioredis'
import type { Server } from 'node:http'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createApp } from '../support/app'
import { startContainers, type TestContainers } from '../support/containers'

describe('health', () => {
  let containers: TestContainers | undefined
  let app: INestApplication<Server> | undefined
  const previousEnv = { DATABASE_URL: process.env.DATABASE_URL, REDIS_URL: process.env.REDIS_URL }

  beforeAll(async () => {
    containers = await startContainers()
    process.env.DATABASE_URL = containers.databaseUrl
    process.env.REDIS_URL = containers.redisUrl
    app = await createApp()
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

  it('con Redis arriba responde 200 con status ok y redis up', async () => {
    const res = await request(server()).get('/api/v1/health')

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ status: 'ok', info: { redis: { status: 'up' } } })
  })

  it('limita a 120 pedidos por minuto por IP y cuenta en Redis', async () => {
    const statuses: number[] = []
    for (let i = 0; i < 121; i++) {
      statuses.push((await request(server()).get('/api/v1/health')).status)
    }

    expect(statuses[0]).toBe(200)
    expect(statuses.at(-1)).toBe(429)

    const client = new Redis(containers?.redisUrl ?? '')
    const keys = await client.keys('*:hits')
    await client.quit()
    expect(keys.length).toBeGreaterThan(0)
  })

  it('con Redis caído responde 200 con status degraded (nunca 500)', async () => {
    await containers?.stopRedis()

    const res = await request(server()).get('/api/v1/health')

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ status: 'degraded', info: { redis: { status: 'degraded' } } })
  })
})
