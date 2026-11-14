import { describe, expect, it, vi } from 'vitest'

import type { SecretsPort } from '../../application/ports/secrets.port'
import { SESSION_TTL_SECONDS } from '../../application/ports/session.port'
import type { Clock } from '../../domain/clock'
import { DomainError } from '../../domain/domain-error'
import {
  type RedisSessionClient,
  type RedisSessionTransaction,
  RedisSessionStore,
} from './redis-session.store'

const NOW = new Date('2026-11-02T12:00:00.000Z')

const clock: Clock = { now: () => NOW }

/** Secretos predecibles: cada token es un contador en hex del largo pedido. */
function countingSecrets(): SecretsPort {
  let counter = 0
  return {
    token: (bytes) => (++counter).toString(16).padStart(bytes * 2, '0'),
    sha256: (value) => value,
  }
}

/** ioredis simulado que funciona: strings y sets en `Map`, transacciones aplicadas en `exec`. */
function workingRedis() {
  const strings = new Map<string, string>()
  const sets = new Map<string, Set<string>>()
  const set = vi.fn<(key: string, value: string, token: 'EX', seconds: number) => void>()
  const expire = vi.fn<(key: string, seconds: number) => void>()
  const del = (keys: string[]): number =>
    keys.filter((key) => strings.delete(key) || sets.delete(key)).length

  const client: RedisSessionClient = {
    get: (key) => Promise.resolve(strings.get(key) ?? null),
    smembers: (key) => Promise.resolve([...(sets.get(key) ?? [])]),
    mget: (...keys) => Promise.resolve(keys.map((key) => strings.get(key) ?? null)),
    multi: () => {
      const queued: (() => unknown)[] = []
      const transaction: RedisSessionTransaction = {
        set(key, value, token, seconds) {
          queued.push(() => {
            set(key, value, token, seconds)
            strings.set(key, value)
            return 'OK'
          })
          return transaction
        },
        sadd(key, member) {
          queued.push(() => sets.set(key, (sets.get(key) ?? new Set()).add(member)))
          return transaction
        },
        srem(key, ...members) {
          queued.push(() => {
            const set = sets.get(key)
            const removed = members.filter((member) => set?.delete(member)).length
            // Como Redis: un set que queda vacío deja de existir.
            if (set?.size === 0) sets.delete(key)
            return removed
          })
          return transaction
        },
        expire(key, seconds) {
          queued.push(() => {
            expire(key, seconds)
            return 1
          })
          return transaction
        },
        del(...keys) {
          queued.push(() => del(keys))
          return transaction
        },
        exec: () => Promise.resolve(queued.map((run): [null, unknown] => [null, run()])),
      }
      return transaction
    },
  }
  return { client, strings, sets, set, expire }
}

/** ioredis simulado con Redis caído: todos los comandos rechazan. */
function failingRedis(): RedisSessionClient {
  const fail = (): Promise<never> =>
    Promise.reject(new Error('connect ECONNREFUSED 127.0.0.1:6379'))
  const transaction: RedisSessionTransaction = {
    set: () => transaction,
    sadd: () => transaction,
    srem: () => transaction,
    expire: () => transaction,
    del: () => transaction,
    exec: fail,
  }
  return { get: fail, smembers: fail, mget: fail, multi: () => transaction }
}

function quietLogger() {
  return { warn: vi.fn<(message: string) => void>() }
}

describe('RedisSessionStore', () => {
  it('crea una sesión de cliente con EX de 30 días y la indexa en el set del usuario', async () => {
    const redis = workingRedis()
    const store = new RedisSessionStore(redis.client, countingSecrets(), clock, quietLogger())

    const session = await store.create({ kind: 'customer', userId: 'u1', customerId: 'c1' })

    expect(session).toEqual({
      id: '1'.padStart(64, '0'),
      kind: 'customer',
      userId: 'u1',
      customerId: 'c1',
      csrfToken: '2'.padStart(64, '0'),
      createdAt: '2026-11-02T12:00:00.000Z',
      authenticatedAt: '2026-11-02T12:00:00.000Z',
      expiresAt: '2026-12-02T12:00:00.000Z',
    })
    expect(redis.set).toHaveBeenCalledWith(
      `session:${session.id}`,
      JSON.stringify(session),
      'EX',
      SESSION_TTL_SECONDS.customer,
    )
    expect(redis.sets.get('user-sessions:u1')).toEqual(new Set([session.id]))
    expect(redis.expire).toHaveBeenCalledWith('user-sessions:u1', 2_592_000)
    await expect(store.get(session.id)).resolves.toEqual(session)
  })

  it('crea una sesión de admin con EX de 8 horas', async () => {
    const redis = workingRedis()
    const store = new RedisSessionStore(redis.client, countingSecrets(), clock, quietLogger())

    const session = await store.create({ kind: 'admin', userId: 'a1', customerId: null })

    expect(redis.set).toHaveBeenCalledWith(
      `session:${session.id}`,
      expect.any(String),
      'EX',
      28_800,
    )
    expect(session.expiresAt).toBe('2026-11-02T20:00:00.000Z')
  })

  it('una sesión anónima dura 30 minutos y no se indexa por usuario (NV-19)', async () => {
    const redis = workingRedis()
    const store = new RedisSessionStore(redis.client, countingSecrets(), clock, quietLogger())

    await store.create({ kind: 'anonymous', userId: null, customerId: null })

    expect(redis.set).toHaveBeenCalledWith(expect.any(String), expect.any(String), 'EX', 1_800)
    expect(redis.sets.size).toBe(0)
  })

  it('get devuelve null si la clave no está, si el id no es hex de 64 o si ya venció', async () => {
    const redis = workingRedis()
    let now = NOW
    const store = new RedisSessionStore(
      redis.client,
      countingSecrets(),
      { now: () => now },
      quietLogger(),
    )
    const session = await store.create({ kind: 'admin', userId: 'a1', customerId: null })

    await expect(store.get('f'.repeat(64))).resolves.toBeNull()
    await expect(store.get('no-es-un-id')).resolves.toBeNull()
    now = new Date(Date.parse(session.expiresAt))
    await expect(store.get(session.id)).resolves.toBeNull()
  })

  it('get trata un valor ilegible como sesión inexistente', async () => {
    const redis = workingRedis()
    const store = new RedisSessionStore(redis.client, countingSecrets(), clock, quietLogger())
    redis.strings.set(`session:${'a'.repeat(64)}`, '{no es json')
    redis.strings.set(`session:${'b'.repeat(64)}`, JSON.stringify({ id: 'b', kind: 'root' }))

    await expect(store.get('a'.repeat(64))).resolves.toBeNull()
    await expect(store.get('b'.repeat(64))).resolves.toBeNull()
  })

  it('destroy borra la sesión y la saca del set del usuario', async () => {
    const redis = workingRedis()
    const store = new RedisSessionStore(redis.client, countingSecrets(), clock, quietLogger())
    const session = await store.create({ kind: 'customer', userId: 'u1', customerId: 'c1' })

    await store.destroy(session.id)

    await expect(store.get(session.id)).resolves.toBeNull()
    expect(redis.sets.get('user-sessions:u1')?.size ?? 0).toBe(0)
  })

  it('destroyAllForUser borra cada id del set y el set', async () => {
    const redis = workingRedis()
    const store = new RedisSessionStore(redis.client, countingSecrets(), clock, quietLogger())
    const first = await store.create({ kind: 'customer', userId: 'u1', customerId: 'c1' })
    const second = await store.create({ kind: 'customer', userId: 'u1', customerId: 'c1' })
    const other = await store.create({ kind: 'customer', userId: 'u2', customerId: 'c2' })

    await store.destroyAllForUser('u1')

    await expect(store.get(first.id)).resolves.toBeNull()
    await expect(store.get(second.id)).resolves.toBeNull()
    await expect(store.get(other.id)).resolves.toEqual(other)
    expect(redis.sets.has('user-sessions:u1')).toBe(false)
  })

  it('destroyAllForUser: si falla el borrado de las sesiones viejas, igual quedan rechazadas y no responde 503 (NV-24)', async () => {
    const redis = workingRedis()
    const logger = quietLogger()
    // Toda transacción con DEL falla (por ejemplo, un índice enorme); el resto anda.
    const deleteFails: RedisSessionClient = {
      ...redis.client,
      multi: () => {
        const transaction = redis.client.multi()
        const del = transaction.del.bind(transaction)
        const exec = transaction.exec.bind(transaction)
        let deletes = false
        transaction.del = (...keys) => {
          deletes = true
          return del(...keys)
        }
        transaction.exec = () =>
          deletes ? Promise.reject(new Error('ERR demasiados argumentos')) : exec()
        return transaction
      },
    }
    const store = new RedisSessionStore(deleteFails, countingSecrets(), clock, logger)
    const old = await store.create({ kind: 'customer', userId: 'u1', customerId: 'c1' })

    await expect(store.destroyAllForUser('u1')).resolves.toBeUndefined()

    await expect(store.get(old.id)).resolves.toBeNull()
    expect(logger.warn).toHaveBeenCalledTimes(1)
  })

  it('falla cerrado: si Redis no responde, lanza DomainError 503 service_unavailable', async () => {
    const logger = quietLogger()
    const store = new RedisSessionStore(failingRedis(), countingSecrets(), clock, logger)

    const error: unknown = await store.get('a'.repeat(64)).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(DomainError)
    expect(error).toMatchObject({
      code: 'service_unavailable',
      status: 503,
      detail: 'No pudimos verificar tu sesión. Probá de nuevo en un momento.',
    })
    await expect(
      store.create({ kind: 'anonymous', userId: null, customerId: null }),
    ).rejects.toBeInstanceOf(DomainError)
    await expect(store.destroy('a'.repeat(64))).rejects.toBeInstanceOf(DomainError)
    await expect(store.destroyAllForUser('u1')).rejects.toBeInstanceOf(DomainError)
    expect(logger.warn).toHaveBeenCalledTimes(1)
  })
})
