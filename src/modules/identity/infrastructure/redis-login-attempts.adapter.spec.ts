import { describe, expect, it, vi } from 'vitest'

import {
  LOGIN_FAILURE_LIMIT,
  LOGIN_FAILURE_WINDOW_SECONDS,
  RedisLoginAttempts,
  type LoginAttemptsRedisClient,
} from './redis-login-attempts.adapter'

/** Email e IP de los intentos de prueba. */
const KEY = { email: 'ana@mail.com', clientIp: '203.0.113.7' }

/** Clave de Redis de {@link KEY}. */
const REDIS_KEY = 'login-fail:203.0.113.7:ana@mail.com'

/** Intento que se puede verificar sin que arranque un bloqueo. */
const FREE = { blockedForSeconds: null, lockedIfFailsSeconds: null }

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
  return { incr: fail, expire: fail, ttl: fail, del: fail }
}

const quietLogger = { warn: vi.fn() }

describe('RedisLoginAttempts', () => {
  it('usa la clave login-fail:{ip}:{email} con una ventana de 15 minutos desde el primer intento', async () => {
    const { client, ttls } = fakeRedis()
    const attempts = new RedisLoginAttempts(client, quietLogger)

    await expect(attempts.attempt(KEY)).resolves.toEqual(FREE)

    expect(client.incr).toHaveBeenCalledWith(REDIS_KEY)
    expect(client.expire).toHaveBeenCalledWith(REDIS_KEY, LOGIN_FAILURE_WINDOW_SECONDS, 'NX')
    expect(ttls.get(REDIS_KEY)).toBe(900)
  })

  it('codifica la IP: una IPv6 no se confunde con el separador', async () => {
    const { client } = fakeRedis()
    const attempts = new RedisLoginAttempts(client, quietLogger)

    await attempts.attempt({ email: 'ana@mail.com', clientIp: '::ffff:127.0.0.1' })

    expect(client.incr).toHaveBeenCalledWith('login-fail:%3A%3Affff%3A127.0.0.1:ana@mail.com')
  })

  it('los primeros nueve se verifican; el décimo avisa el bloqueo si falla; del once en adelante, bloqueado', async () => {
    const { client, ttls } = fakeRedis()
    const attempts = new RedisLoginAttempts(client, quietLogger)

    for (let i = 1; i < LOGIN_FAILURE_LIMIT; i++) {
      await expect(attempts.attempt(KEY)).resolves.toEqual(FREE)
    }
    ttls.set(REDIS_KEY, 612)

    await expect(attempts.attempt(KEY)).resolves.toEqual({
      blockedForSeconds: null,
      lockedIfFailsSeconds: 612,
    })
    await expect(attempts.attempt(KEY)).resolves.toEqual({
      blockedForSeconds: 612,
      lockedIfFailsSeconds: null,
    })
  })

  it('si el TTL no se puede leer, el bloqueo dura la ventana entera (nunca deja pasar)', async () => {
    const { client } = fakeRedis()
    client.expire.mockResolvedValue(0)
    const attempts = new RedisLoginAttempts(client, quietLogger)
    for (let i = 0; i < LOGIN_FAILURE_LIMIT; i++) await attempts.attempt(KEY)

    await expect(attempts.attempt(KEY)).resolves.toEqual({
      blockedForSeconds: LOGIN_FAILURE_WINDOW_SECONDS,
      lockedIfFailsSeconds: null,
    })
  })

  it('cuenta cada IP por separado y clear olvida solo el par', async () => {
    const { client } = fakeRedis()
    const attempts = new RedisLoginAttempts(client, quietLogger)
    for (let i = 0; i < LOGIN_FAILURE_LIMIT; i++) await attempts.attempt(KEY)

    await expect(attempts.attempt({ ...KEY, clientIp: '198.51.100.23' })).resolves.toEqual(FREE)
    await attempts.clear(KEY)

    expect(client.del).toHaveBeenCalledWith(REDIS_KEY)
    await expect(attempts.attempt(KEY)).resolves.toEqual(FREE)
  })

  it('falla abierta: sin Redis nada queda bloqueado y nada lanza (con un solo aviso)', async () => {
    const logger = { warn: vi.fn() }
    const attempts = new RedisLoginAttempts(downRedis(), logger)

    await expect(attempts.attempt(KEY)).resolves.toEqual(FREE)
    await expect(attempts.clear(KEY)).resolves.toBeUndefined()
    expect(logger.warn).toHaveBeenCalledTimes(1)
  })

  it('rechaza un email o una IP vacíos', async () => {
    const attempts = new RedisLoginAttempts(fakeRedis().client, quietLogger)

    await expect(attempts.attempt({ ...KEY, email: ' ' })).rejects.toThrow(
      'El email no puede estar vacío',
    )
    await expect(attempts.attempt({ ...KEY, clientIp: '' })).rejects.toThrow(
      'La IP del cliente no puede estar vacía',
    )
  })
})
