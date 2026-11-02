import { describe, expect, it, vi } from 'vitest'

import type { CachePort } from '../../../shared/application/ports/cache.port'
import { Product } from '../domain/product.entity'
import type { ProductFilter, ProductRepository } from '../application/ports/product.repository.port'
import { CATALOG_CACHE_TTL_SECONDS, CachedProductRepository } from './cached-product.repository'

const PRODUCT = Product.create({
  id: 'p1',
  sequence: 1,
  slug: 'mate-imperial-premium',
  name: 'Mate Imperial Premium',
  description: 'Calabaza.',
  priceArs: 39999,
  status: 'published',
  featured: true,
  category: { id: 'c1', slug: 'imperiales', name: 'Imperiales', group: 'mate' },
  images: [],
  inventory: { onHand: 12, reserved: 0 },
  tabsOverride: null,
  rating: { average: 4.5, count: 2 },
})

/** Caché en memoria que anota cada `set`. */
function memoryCache() {
  const store = new Map<string, unknown>()
  const set = vi.fn<CachePort['set']>((key, value) => {
    store.set(key, JSON.parse(JSON.stringify(value)))
    return Promise.resolve()
  })
  const cache: CachePort = {
    get: <T>(key: string) => Promise.resolve((store.get(key) as T | undefined) ?? null),
    set,
    del: () => Promise.resolve(),
  }
  return { cache, set }
}

/** Caché caída: nunca encuentra nada y no guarda nada (como `RedisCacheAdapter` sin Redis). */
const downCache: CachePort = {
  get: () => Promise.resolve(null),
  set: () => Promise.resolve(),
  del: () => Promise.resolve(),
}

function innerRepository() {
  const inner = {
    list: vi.fn<ProductRepository['list']>(() => Promise.resolve({ items: [PRODUCT], total: 1 })),
    findBySlug: vi.fn((slug: string) => Promise.resolve(slug === PRODUCT.slug ? PRODUCT : null)),
    listPublishedByGroup: vi.fn<ProductRepository['listPublishedByGroup']>(() =>
      Promise.resolve([PRODUCT]),
    ),
  } satisfies ProductRepository
  return inner
}

const FILTER: ProductFilter = { group: 'mate', sort: 'menor', page: 1, pageSize: 100 }

describe('CachedProductRepository', () => {
  it('guarda el listado 60 s con una clave catalog: que incluye el filtro', async () => {
    const inner = innerRepository()
    const { cache, set } = memoryCache()
    const repository = new CachedProductRepository(inner, cache)

    const first = await repository.list(FILTER)
    const second = await repository.list({ ...FILTER })
    await repository.list({ ...FILTER, page: 2 })

    expect(inner.list).toHaveBeenCalledTimes(2)
    expect(second.total).toBe(1)
    expect(second.items[0]?.toProps()).toEqual(first.items[0]?.toProps())
    expect(second.items[0]?.code()).toBe('N°01')
    const [key, , ttl] = set.mock.calls[0] ?? []
    expect(key).toMatch(/^catalog:products:list:/)
    expect(key).toContain('"menor"')
    expect(ttl).toBe(CATALOG_CACHE_TTL_SECONDS)
    expect(CATALOG_CACHE_TTL_SECONDS).toBe(60)
    expect(set.mock.calls[1]?.[0]).not.toBe(key)
  })

  it('cachea la ficha por slug y no guarda los que no existen', async () => {
    const inner = innerRepository()
    const { cache, set } = memoryCache()
    const repository = new CachedProductRepository(inner, cache)

    await repository.findBySlug(PRODUCT.slug)
    const again = await repository.findBySlug(PRODUCT.slug)
    await expect(repository.findBySlug('no-existe')).resolves.toBeNull()

    expect(again?.id).toBe('p1')
    expect(inner.findBySlug).toHaveBeenCalledTimes(2)
    expect(set.mock.calls.map(([key]) => key)).toEqual([
      'catalog:products:slug:mate-imperial-premium',
    ])
  })

  it('con la caché caída responde siempre desde el repositorio', async () => {
    const inner = innerRepository()
    const repository = new CachedProductRepository(inner, downCache)

    await repository.listPublishedByGroup('mate')
    const products = await repository.listPublishedByGroup('mate')

    expect(products.map(({ id }) => id)).toEqual(['p1'])
    expect(inner.listPublishedByGroup).toHaveBeenCalledTimes(2)
  })
})
