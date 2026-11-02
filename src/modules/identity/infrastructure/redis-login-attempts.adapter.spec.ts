import { describe, expect, it, vi } from 'vitest'

import {
  LOGIN_FAILURE_LIMIT,
  LOGIN_FAILURE_WINDOW_SECONDS,
  RedisLoginAttempts,
  type LoginAttemptsRedisClient,
} from './redis-login-attempts.adapter'

/** ioredis simulado: contadores en memoria con TTL fijo (el tiempo no corre). */
function fakeRedis() {
  const values = new Map<string, number>()
  const ttls = new Map<string, number>()
  const client = {
    incr: vi.fn((key: string) => {
      const next = (values.get(key) ?? 0) + 1
      values.set(key, next)
      return Promise.resolve(next)
    }),
    // Como `EXPIRE … NX`: pone el vencimiento si la clave existe y todavía no tiene uno.
    expire: vi.fn((key: string, seconds: number) => {
      if (!values.has(key) || ttls.has(key)) return Promise.resolve(0)
      ttls.set(key, seconds)
      return Promise.resolve(1)
    }),
    ttl: vi.fn((key: string) => Promise.resolve(values.has(key) ? (ttls.get(key) ?? -1) : -2)),
    get: vi.fn((key: string) => {
      const value = values.get(key)
      return Promise.resolve(value === undefined ? null : String(value))
    }),
    del: vi.fn((key: string) => {
      const had = values.delete(key)
      ttls.delete(key)
      return Promise.resolve(had ? 1 : 0)
    }),
  } satisfies LoginAttemptsRedisClient
  return { client, ttls }
}

/** Redis caído: todos los comandos fallan. */
function downRedis(): LoginAttemptsRedisClient {
  const fail = () => Promise.reject(new Error('Connection is closed.'))
  return { incr: fail, expire: fail, ttl: fail, get: fail, del: fail }
}

const quietLogger = { warn: vi.fn() }

describe('RedisLoginAttempts', () => {
  it('usa la clave login-fail:{email} con una ventana de 15 minutos desde el primer fallo', async () => {
    const { client, ttls } = fakeRedis()
    const attempts = new RedisLoginAttempts(client, quietLogger)

    await expect(attempts.fail('ana@mail.com')).resolves.toEqual({ blockedForSeconds: null })

    expect(client.incr).toHaveBeenCalledWith('login-fail:ana@mail.com')
    expect(client.expire).toHaveBeenCalledWith(
      'login-fail:ana@mail.com',
      LOGIN_FAILURE_WINDOW_SECONDS,
      'NX',
    )
    expect(ttls.get('login-fail:ana@mail.com')).toBe(900)
  })

  it('los primeros nueve fallos no bloquean; el décimo bloquea por el TTL que queda', async () => {
    const { client, ttls } = fakeRedis()
    const attempts = new RedisLoginAttempts(client, quietLogger)

    for (let i = 1; i < LOGIN_FAILURE_LIMIT; i++) {
      await expect(attempts.fail('ana@mail.com')).resolves.toEqual({ blockedForSeconds: null })
    }
    await expect(attempts.blockedFor('ana@mail.com')).resolves.toBeNull()

    ttls.set('login-fail:ana@mail.com', 612)
    await expect(attempts.fail('ana@mail.com')).resolves.toEqual({ blockedForSeconds: 612 })
    await expect(attempts.blockedFor('ana@mail.com')).resolves.toBe(612)
  })

  it('clear olvida los fallos', async () => {
    const { client } = fakeRedis()
    const attempts = new RedisLoginAttempts(client, quietLogger)
    for (let i = 0; i < LOGIN_FAILURE_LIMIT; i++) await attempts.fail('ana@mail.com')

    await attempts.clear('ana@mail.com')

    expect(client.del).toHaveBeenCalledWith('login-fail:ana@mail.com')
    await expect(attempts.blockedFor('ana@mail.com')).resolves.toBeNull()
  })

  it('falla abierta: sin Redis nada queda bloqueado y nada lanza (con un solo aviso)', async () => {
    const logger = { warn: vi.fn() }
    const attempts = new RedisLoginAttempts(downRedis(), logger)

    await expect(attempts.fail('ana@mail.com')).resolves.toEqual({ blockedForSeconds: null })
    await expect(attempts.blockedFor('ana@mail.com')).resolves.toBeNull()
    await expect(attempts.clear('ana@mail.com')).resolves.toBeUndefined()
    expect(logger.warn).toHaveBeenCalledTimes(1)
  })

  it('rechaza un email vacío', async () => {
    const attempts = new RedisLoginAttempts(fakeRedis().client, quietLogger)

    await expect(attempts.fail(' ')).rejects.toThrow('El email no puede estar vacío')
  })
})
