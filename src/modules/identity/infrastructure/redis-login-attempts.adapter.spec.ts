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

  describe('tope por email (NV-09): 100 fallos en una hora, sin importar la IP', () => {
    /** Intentos verificados por email en la hora, desde cualquier IP. */
    const EMAIL_LIMIT = 100

    /** Clave del tope por email de {@link KEY}. */
    const EMAIL_KEY = 'login-fail-email:ana@mail.com'

    /** IP número `n` (cada una prueba menos que el tope por IP). */
    const ipNumber = (n: number) => `198.51.100.${String(n)}`

    /** `count` intentos de {@link KEY} repartidos de a 9 por IP (ninguna IP llega a su tope). */
    async function spread(attempts: RedisLoginAttempts, count: number) {
      const results = []
      for (let i = 0; i < count; i++) {
        results.push(await attempts.attempt({ ...KEY, clientIp: ipNumber(Math.floor(i / 9)) }))
      }
      return results
    }

    it('usa la clave login-fail-email:{email} con una ventana de una hora desde el primer intento', async () => {
      const { client, ttls } = fakeRedis()
      const attempts = new RedisLoginAttempts(client, quietLogger)

      await attempts.attempt(KEY)

      expect(client.incr).toHaveBeenCalledWith(EMAIL_KEY)
      expect(client.expire).toHaveBeenCalledWith(EMAIL_KEY, 3_600, 'NX')
      expect(ttls.get(EMAIL_KEY)).toBe(3_600)
    })

    it('rotando IPs, los primeros 99 se verifican, el 100 avisa el bloqueo y el 101 queda bloqueado desde cualquier IP', async () => {
      const { client, ttls } = fakeRedis()
      const attempts = new RedisLoginAttempts(client, quietLogger)

      const allowed = await spread(attempts, EMAIL_LIMIT - 1)
      expect(allowed).toEqual(Array.from({ length: EMAIL_LIMIT - 1 }, () => FREE))
      ttls.set(EMAIL_KEY, 2_400)

      await expect(attempts.attempt({ ...KEY, clientIp: '192.0.2.1' })).resolves.toEqual({
        blockedForSeconds: null,
        lockedIfFailsSeconds: 2_400,
      })
      await expect(attempts.attempt({ ...KEY, clientIp: '192.0.2.2' })).resolves.toEqual({
        blockedForSeconds: 2_400,
        lockedIfFailsSeconds: null,
      })
      await expect(attempts.attempt({ ...KEY, email: 'otra@mail.com' })).resolves.toEqual(FREE)
    })

    it('los intentos que el bloqueo por IP ya frenó no suman: desde una sola IP no se bloquea al dueño', async () => {
      const { client } = fakeRedis()
      const attempts = new RedisLoginAttempts(client, quietLogger)

      for (let i = 0; i < EMAIL_LIMIT * 2; i++) await attempts.attempt(KEY)

      await expect(attempts.attempt({ ...KEY, clientIp: '192.0.2.9' })).resolves.toEqual(FREE)
    })

    it('si el par y el email avisan a la vez, el bloqueo que arranca es el más largo', async () => {
      const { client, ttls } = fakeRedis()
      const attempts = new RedisLoginAttempts(client, quietLogger)
      await spread(attempts, EMAIL_LIMIT - LOGIN_FAILURE_LIMIT)
      for (let i = 1; i < LOGIN_FAILURE_LIMIT; i++) await attempts.attempt(KEY)
      ttls.set(REDIS_KEY, 300)
      ttls.set(EMAIL_KEY, 1_800)

      await expect(attempts.attempt(KEY)).resolves.toEqual({
        blockedForSeconds: null,
        lockedIfFailsSeconds: 1_800,
      })
    })

    it('un inicio de sesión correcto (clear) olvida también los fallos del email', async () => {
      const { client } = fakeRedis()
      const attempts = new RedisLoginAttempts(client, quietLogger)
      await spread(attempts, EMAIL_LIMIT + 1)

      await attempts.clear(KEY)

      expect(client.del).toHaveBeenCalledWith(EMAIL_KEY)
      await expect(attempts.attempt({ ...KEY, clientIp: '192.0.2.3' })).resolves.toEqual(FREE)
    })
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
