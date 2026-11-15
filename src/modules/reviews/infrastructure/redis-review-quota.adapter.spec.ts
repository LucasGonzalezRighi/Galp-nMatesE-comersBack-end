import { describe, expect, it, vi } from 'vitest'

import {
  MAX_PENDING_REVIEWS_PER_IP,
  REVIEW_QUOTA_WINDOW_SECONDS,
} from '../domain/review-moderation'
import { RedisReviewQuota } from './redis-review-quota.adapter'

/** ioredis simulado: contadores en memoria con TTL fijo (el tiempo no corre). */
function fakeRedis() {
  const values = new Map<string, number>()
  const ttls = new Map<string, number>()
  return {
    values,
    ttls,
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
  }
}

describe('RedisReviewQuota (NV-21)', () => {
  it(`deja pasar ${String(MAX_PENDING_REVIEWS_PER_IP)} reseñas por IP en el día; la siguiente dice cuánto falta`, async () => {
    const redis = fakeRedis()
    const quota = new RedisReviewQuota(redis, { warn: vi.fn() })

    const results: (number | null)[] = []
    for (let i = 0; i <= MAX_PENDING_REVIEWS_PER_IP; i += 1) {
      results.push(await quota.take('2001:db8::7'))
    }

    expect(results).toEqual([
      ...Array<null>(MAX_PENDING_REVIEWS_PER_IP).fill(null),
      REVIEW_QUOTA_WINDOW_SECONDS,
    ])
    expect([...redis.values.keys()]).toEqual(['review-quota:2001%3Adb8%3A%3A7'])
    expect(redis.expire).toHaveBeenCalledWith(
      'review-quota:2001%3Adb8%3A%3A7',
      REVIEW_QUOTA_WINDOW_SECONDS,
      'NX',
    )
    await expect(quota.take('203.0.113.8')).resolves.toBeNull()
  })

  it('con Redis caído deja pasar y avisa una vez por minuto', async () => {
    const warn = vi.fn()
    const broken = {
      incr: () => Promise.reject(new Error('Connection is closed.')),
      expire: () => Promise.resolve(0),
      ttl: () => Promise.resolve(-2),
    }
    const quota = new RedisReviewQuota(broken, { warn }, () => 0)

    await expect(quota.take('203.0.113.8')).resolves.toBeNull()
    await expect(quota.take('203.0.113.8')).resolves.toBeNull()
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('una IP vacía es un error de programación', async () => {
    const quota = new RedisReviewQuota(fakeRedis(), { warn: vi.fn() })

    await expect(quota.take(' ')).rejects.toThrow(TypeError)
  })
})
