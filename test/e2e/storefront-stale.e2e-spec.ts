import type { INestApplication } from '@nestjs/common'
import type { Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { seed } from '../../prisma/seed'
import { bumpCatalogCacheVersion } from '../../src/modules/catalog/infrastructure/catalog-cache'
import { CACHE_PORT, type CachePort } from '../../src/shared/application/ports/cache.port'
import { OutboxRelay } from '../../src/shared/infrastructure/outbox/outbox.relay'
import { PrismaService } from '../../src/shared/infrastructure/prisma/prisma.service'
import { createApp } from '../support/app'
import { startContainers, type TestContainers } from '../support/containers'
import { type FakeStore, startFakeStore } from '../support/fake-store'
import { call, newJar } from '../support/http'
import { mateLine, ordersHttp } from '../support/orders-http'

/** Secreto de la tienda falsa (`STORE_REVALIDATE_SECRET`, mínimo 32 caracteres). */
const SECRET = 's'.repeat(32)

const SLUG = 'mate-imperial-premium'

describe('aviso storefront.stale y caché del catálogo con versión (HTTP + Postgres + Redis + tienda falsa)', () => {
  let containers: TestContainers | undefined
  let app: INestApplication<Server> | undefined
  let store: FakeStore | undefined
  const previousEnv = {
    DATABASE_URL: process.env.DATABASE_URL,
    REDIS_URL: process.env.REDIS_URL,
    STORE_ORIGIN: process.env.STORE_ORIGIN,
    STORE_REVALIDATE_SECRET: process.env.STORE_REVALIDATE_SECRET,
  }

  beforeAll(async () => {
    store = await startFakeStore()
    containers = await startContainers()
    process.env.DATABASE_URL = containers.databaseUrl
    process.env.REDIS_URL = containers.redisUrl
    process.env.STORE_ORIGIN = store.origin
    process.env.STORE_REVALIDATE_SECRET = SECRET
    app = await createApp()
    await seed(app.get(PrismaService))
  })

  afterAll(async () => {
    await app?.close()
    await containers?.stop()
    await store?.close()
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) Reflect.deleteProperty(process.env, key)
      else process.env[key] = value
    }
  })

  function server(): Server {
    if (app === undefined) throw new Error('La app no arrancó')
    return app.getHttpServer()
  }

  function get<T>(token: string | symbol | (abstract new (...args: never[]) => T)): T {
    if (app === undefined) throw new Error('La app no arrancó')
    return app.get<T>(token)
  }

  function fakeStore(): FakeStore {
    if (store === undefined) throw new Error('La tienda falsa no arrancó')
    return store
  }

  const { orderBody, createdOrder } = ordersHttp(server)

  async function productName(): Promise<string> {
    const response = await call(server(), newJar(), 'get', `/products/${SLUG}`)
    expect(response.status).toBe(200)
    return (response.body as { name: string }).name
  }

  it('un POST /orders le avisa a la tienda una sola vez: products y combos', async () => {
    const mate = await get(PrismaService).product.findUniqueOrThrow({
      where: { slug: SLUG },
      select: { id: true },
    })

    const created = await createdOrder(
      newJar(),
      await orderBody([mateLine(mate.id)], 'stale@example.com'),
    )
    await get(OutboxRelay).runOnce()

    await vi.waitFor(
      () => {
        expect(fakeStore().tags()).toEqual([['products', 'combos']])
      },
      { timeout: 15_000, interval: 200 },
    )
    const [received] = fakeStore().requests
    expect(received).toMatchObject({
      method: 'POST',
      url: '/api/revalidate',
      body: '{"tags":["products","combos"]}',
    })
    expect(received?.headers['x-revalidate-secret']).toBe(SECRET)
    const stale = await get(PrismaService).outboxEvent.findMany({
      where: { type: 'storefront.stale' },
    })
    expect(stale).toHaveLength(1)
    expect(stale[0]).toMatchObject({
      aggregateType: 'storefront',
      aggregateId: 'order.created',
      payload: { reason: 'order.created', tags: ['products', 'combos'] },
    })
    expect(created.order.number).toMatch(/^GLP-/)
  })

  it('la ficha cacheada sigue vieja sin bump y trae lo nuevo después de bumpCatalogCacheVersion', async () => {
    const original = await productName()
    await get(PrismaService).product.update({
      where: { slug: SLUG },
      data: { name: 'Mate Imperial Renombrado' },
    })

    expect(await productName()).toBe(original)

    await bumpCatalogCacheVersion(get<CachePort>(CACHE_PORT))

    expect(await productName()).toBe('Mate Imperial Renombrado')
  })
})
