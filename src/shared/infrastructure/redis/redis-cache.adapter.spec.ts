import { describe, expect, it, vi } from 'vitest'

import { type RedisCacheClient, RedisCacheAdapter } from './redis-cache.adapter'

/** ioredis simulado que funciona: guarda los valores en un `Map`. */
function workingRedis() {
  const store = new Map<string, string>()
  const set = vi.fn((key: string, value: string) => {
    store.set(key, value)
    return Promise.resolve('OK' as const)
  })
  const del = vi.fn((...keys: string[]) =>
    Promise.resolve(keys.filter((key) => store.delete(key)).length),
  )
  const client: RedisCacheClient = {
    get: (key) => Promise.resolve(store.get(key) ?? null),
    set,
    del,
  }
  return { client, store, set, del }
}

/** ioredis simulado con Redis caído: todos los comandos rechazan. */
function failingRedis(): RedisCacheClient {
  const fail = (): Promise<never> =>
    Promise.reject(new Error('connect ECONNREFUSED 127.0.0.1:6379'))
  return { get: fail, set: fail, del: fail }
}

function fakeLogger() {
  return { warn: vi.fn<(message: string) => void>() }
}

describe('RedisCacheAdapter', () => {
  describe('con Redis caído (falla abierta)', () => {
    it('get devuelve null y set/del no lanzan', async () => {
      const cache = new RedisCacheAdapter(failingRedis(), fakeLogger())

      await expect(cache.get('catalog:products')).resolves.toBeNull()
      await expect(cache.set('catalog:products', { a: 1 }, 60)).resolves.toBeUndefined()
      await expect(cache.del('catalog:products')).resolves.toBeUndefined()
    })

    it('loguea un warn como mucho una vez por minuto', async () => {
      let now = 1_000_000
      const logger = fakeLogger()
      const cache = new RedisCacheAdapter(failingRedis(), logger, () => now)

      await cache.get('a')
      await cache.set('a', 1, 60)
      await cache.del('a')
      expect(logger.warn).toHaveBeenCalledTimes(1)

      now += 59_999
      await cache.get('a')
      expect(logger.warn).toHaveBeenCalledTimes(1)

      now += 1
      await cache.get('a')
      expect(logger.warn).toHaveBeenCalledTimes(2)
    })
  })

  describe('con Redis funcionando', () => {
    it('set + get devuelven el mismo objeto (JSON) y set usa el TTL en segundos', async () => {
      const redis = workingRedis()
      const cache = new RedisCacheAdapter(redis.client, fakeLogger())
      const product = { slug: 'mate-imperial', price_ars: 45_000, tags: ['calabaza'] }

      await cache.set('catalog:product:mate-imperial', product, 300)

      expect(redis.set).toHaveBeenCalledWith(
        'catalog:product:mate-imperial',
        JSON.stringify(product),
        'EX',
        300,
      )
      await expect(cache.get('catalog:product:mate-imperial')).resolves.toEqual(product)
    })

    it('get de una clave que no está devuelve null', async () => {
      const cache = new RedisCacheAdapter(workingRedis().client, fakeLogger())

      await expect(cache.get('no-existe')).resolves.toBeNull()
    })

    it('del borra las claves', async () => {
      const cache = new RedisCacheAdapter(workingRedis().client, fakeLogger())
      await cache.set('a', 1, 60)
      await cache.set('b', 2, 60)

      await cache.del('a', 'b')

      await expect(cache.get('a')).resolves.toBeNull()
      await expect(cache.get('b')).resolves.toBeNull()
    })

    it('un valor guardado que no es JSON válido cuenta como ausente', async () => {
      const redis = workingRedis()
      redis.store.set('roto', '{no es json')
      const logger = fakeLogger()
      const cache = new RedisCacheAdapter(redis.client, logger)

      await expect(cache.get('roto')).resolves.toBeNull()
      expect(logger.warn).toHaveBeenCalledTimes(1)
    })
  })

  describe('validación de argumentos', () => {
    it('rechaza una clave vacía', async () => {
      const cache = new RedisCacheAdapter(workingRedis().client, fakeLogger())

      await expect(cache.get('')).rejects.toThrow('La clave de caché no puede estar vacía')
      await expect(cache.set(' ', 1, 60)).rejects.toThrow('La clave de caché no puede estar vacía')
      await expect(cache.del('a', '')).rejects.toThrow('La clave de caché no puede estar vacía')
    })

    it('rechaza un TTL que no es un entero positivo', async () => {
      const cache = new RedisCacheAdapter(workingRedis().client, fakeLogger())

      await expect(cache.set('a', 1, 0)).rejects.toThrow('entero positivo')
      await expect(cache.set('a', 1, 1.5)).rejects.toThrow('entero positivo')
    })

    it('del sin claves no hace nada', async () => {
      const redis = workingRedis()
      const cache = new RedisCacheAdapter(redis.client, fakeLogger())

      await cache.del()

      expect(redis.del).not.toHaveBeenCalled()
    })
  })
})
