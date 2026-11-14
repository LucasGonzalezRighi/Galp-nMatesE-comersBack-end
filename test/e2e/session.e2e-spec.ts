import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { parseEnv } from '../../src/config/env'
import { SESSION_TTL_SECONDS } from '../../src/shared/application/ports/session.port'
import { SystemClock } from '../../src/shared/domain/clock'
import { DomainError } from '../../src/shared/domain/domain-error'
import { RedisService } from '../../src/shared/infrastructure/redis/redis.service'
import { CryptoSecrets } from '../../src/shared/infrastructure/session/crypto-secrets.adapter'
import { RedisSessionStore } from '../../src/shared/infrastructure/session/redis-session.store'
import { REDIS_IMAGE } from '../support/containers'

/** Avisos de Redis caído: el último test los provoca a propósito y no hace falta verlos. */
const silentLogger = { warn: (): void => undefined }

/**
 * `RedisSessionStore` contra un Redis 8 real (Testcontainers), con el mismo cliente que la app
 * (`RedisService`: sin cola offline, timeouts cortos). Solo levanta Redis: las sesiones no usan
 * Postgres.
 */
describe('RedisSessionStore (Redis real)', () => {
  let container: StartedRedisContainer | undefined
  let redisRunning = false
  let redis: RedisService | undefined
  let store: RedisSessionStore | undefined

  beforeAll(async () => {
    container = await new RedisContainer(REDIS_IMAGE).start()
    redisRunning = true
    redis = new RedisService(
      parseEnv({
        NODE_ENV: 'test',
        DATABASE_URL: 'postgresql://galpon:galpon@127.0.0.1:1/galpon',
        REDIS_URL: container.getConnectionUrl(),
      }),
    )
    await redis.onModuleInit()
    store = new RedisSessionStore(
      redis.client,
      new CryptoSecrets(),
      new SystemClock(),
      silentLogger,
    )
  })

  /** Detiene Redis (una sola vez), para probar que el almacén falla cerrado. */
  async function stopRedis(): Promise<void> {
    if (!redisRunning || container === undefined) return
    redisRunning = false
    await container.stop()
  }

  afterAll(async () => {
    await redis?.onApplicationShutdown()
    await stopRedis()
  })

  function sessions(): RedisSessionStore {
    if (store === undefined) throw new Error('El almacén de sesiones no se creó')
    return store
  }

  function client(): RedisService['client'] {
    if (redis === undefined) throw new Error('El cliente de Redis no se creó')
    return redis.client
  }

  it('create y get: la sesión vuelve igual, con expiresAt = createdAt + TTL', async () => {
    const before = Date.now()
    const session = await sessions().create({
      kind: 'customer',
      userId: 'user-1',
      customerId: 'customer-1',
    })

    expect(session.id).toMatch(/^[0-9a-f]{64}$/)
    expect(session.csrfToken).toMatch(/^[0-9a-f]{64}$/)
    expect(session.csrfToken).not.toBe(session.id)
    expect(Date.parse(session.createdAt)).toBeGreaterThanOrEqual(before - 1_000)
    expect(Date.parse(session.expiresAt) - Date.parse(session.createdAt)).toBe(
      SESSION_TTL_SECONDS.customer * 1000,
    )
    await expect(sessions().get(session.id)).resolves.toEqual(session)
  })

  it('la clave session:{id} tiene TTL de Redis de hasta 30 días', async () => {
    const session = await sessions().create({
      kind: 'customer',
      userId: 'user-ttl',
      customerId: 'customer-ttl',
    })

    const ttl = await client().ttl(`session:${session.id}`)

    expect(ttl).toBeLessThanOrEqual(2_592_000)
    expect(ttl).toBeGreaterThan(2_592_000 - 60)
    await expect(client().ttl('user-sessions:user-ttl')).resolves.toBeGreaterThan(0)
  })

  it('destroy cierra una sesión y destroyAllForUser cierra todas las del usuario', async () => {
    const first = await sessions().create({ kind: 'admin', userId: 'admin-1', customerId: null })
    const second = await sessions().create({ kind: 'admin', userId: 'admin-1', customerId: null })
    const third = await sessions().create({ kind: 'admin', userId: 'admin-1', customerId: null })
    const other = await sessions().create({ kind: 'admin', userId: 'admin-2', customerId: null })

    await sessions().destroy(third.id)
    await expect(sessions().get(third.id)).resolves.toBeNull()
    await expect(client().smembers('user-sessions:admin-1')).resolves.toHaveLength(2)

    await sessions().destroyAllForUser('admin-1')

    await expect(sessions().get(first.id)).resolves.toBeNull()
    await expect(sessions().get(second.id)).resolves.toBeNull()
    await expect(sessions().get(other.id)).resolves.toEqual(other)
    await expect(client().exists(`session:${first.id}`)).resolves.toBe(0)
    await expect(client().scard('user-sessions:admin-1')).resolves.toBe(0)
  })

  it('destroyAllForUser rechaza también la sesión que se abre después con una credencial comprobada antes (NV-03)', async () => {
    // El login leyó el hash viejo antes del cambio y crea su sesión recién después del cierre.
    const checkedBefore = new Date(Date.now() - 1_000)
    await sessions().destroyAllForUser('race-1')
    const late = await sessions().create({
      kind: 'customer',
      userId: 'race-1',
      customerId: 'customer-race-1',
      authenticatedAt: checkedBefore,
    })
    const fresh = await sessions().create({
      kind: 'customer',
      userId: 'race-1',
      customerId: 'customer-race-1',
      authenticatedAt: new Date(Date.now() + 1_000),
    })

    await expect(sessions().get(late.id)).resolves.toBeNull()
    await expect(sessions().get(fresh.id)).resolves.toEqual(fresh)
  })

  it('destroyAllForUser con keep cierra las demás y deja viva (renovada) la que se conserva (NV-32)', async () => {
    const current = await sessions().create({ kind: 'admin', userId: 'keep-1', customerId: null })
    const other = await sessions().create({ kind: 'admin', userId: 'keep-1', customerId: null })

    await sessions().destroyAllForUser('keep-1', { keep: current.id })

    const kept = await sessions().get(current.id)
    expect(kept).toMatchObject({
      id: current.id,
      csrfToken: current.csrfToken,
      expiresAt: current.expiresAt,
    })
    await expect(sessions().get(other.id)).resolves.toBeNull()
    await expect(client().smembers('user-sessions:keep-1')).resolves.toEqual([current.id])
  })

  it('un usuario tiene como mucho 20 sesiones: la 21 descarta la más vieja', async () => {
    const created = []
    for (let index = 0; index < 21; index++) {
      created.push(await sessions().create({ kind: 'admin', userId: 'cap-1', customerId: null }))
      // La antigüedad se mide en milisegundos: cada una, en uno distinto.
      await new Promise((resolve) => setTimeout(resolve, 2))
    }

    const alive = await Promise.all(created.map((session) => sessions().get(session.id)))

    expect(alive[0]).toBeNull()
    expect(alive.slice(1).every((session) => session !== null)).toBe(true)
    await expect(client().scard('user-sessions:cap-1')).resolves.toBe(20)
  })

  it('con Redis caído, get lanza DomainError 503 service_unavailable (falla cerrado)', async () => {
    const session = await sessions().create({ kind: 'anonymous', userId: null, customerId: null })
    await stopRedis()

    const error: unknown = await sessions()
      .get(session.id)
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(DomainError)
    expect(error).toMatchObject({ code: 'service_unavailable', status: 503 })
  })
})
