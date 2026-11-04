import { describe, expect, it, vi } from 'vitest'

import type { CachePort } from '../../../shared/application/ports/cache.port'
import { Product } from '../domain/product.entity'
import type { ProductFilter, ProductRepository } from '../application/ports/product.repository.port'
import { CachedProductRepository } from './cached-product.repository'
import { CATALOG_CACHE_TTL_SECONDS, bumpCatalogCacheVersion } from './catalog-cache'

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
  leathers: ['Negro', 'Crudo'],
})

/** Caché en memoria que anota cada `get` y cada `set`. */
function memoryCache() {
  const store = new Map<string, unknown>()
  const get = vi.fn((key: string): unknown => store.get(key) ?? null)
  const set = vi.fn<CachePort['set']>((key, value) => {
    store.set(key, JSON.parse(JSON.stringify(value)))
    return Promise.resolve()
  })
  const cache: CachePort = {
    get: <T>(key: string) => Promise.resolve(get(key) as T | null),
    set,
    del: () => Promise.resolve(),
    incr: (key) => {
      const next = Number(store.get(key) ?? 0) + 1
      store.set(key, next)
      return Promise.resolve(next)
    },
  }
  return { cache, get, set }
}

/** Caché caída: nunca encuentra nada y no guarda nada (como `RedisCacheAdapter` sin Redis). */
const downCache: CachePort = {
  get: () => Promise.resolve(null),
  set: () => Promise.resolve(),
  del: () => Promise.resolve(),
  incr: () => Promise.resolve(null),
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
    expect(key).toMatch(/^catalog:v0:products:list:/)
    expect(key).toContain('"menor"')
    expect(ttl).toBe(CATALOG_CACHE_TTL_SECONDS)
    expect(CATALOG_CACHE_TTL_SECONDS).toBe(60)
    expect(set.mock.calls[1]?.[0]).not.toBe(key)
  })

  it('no cachea los listados por ids (la tienda concilia el stock con ellos)', async () => {
    const inner = innerRepository()
    const { cache, get, set } = memoryCache()
    const repository = new CachedProductRepository(inner, cache)
    const byIds: ProductFilter = { ...FILTER, group: undefined, ids: [PRODUCT.id] }

    await repository.list(byIds)
    const again = await repository.list(byIds)

    expect(again.items.map(({ id }) => id)).toEqual(['p1'])
    expect(inner.list).toHaveBeenCalledTimes(2)
    expect(get).not.toHaveBeenCalled()
    expect(set).not.toHaveBeenCalled()
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
      'catalog:v0:products:slug:mate-imperial-premium',
    ])
  })

  it('lee la versión en cada lectura: después de un bump la misma ficha vuelve a Postgres', async () => {
    const inner = innerRepository()
    const { cache, set } = memoryCache()
    const repository = new CachedProductRepository(inner, cache)

    await repository.findBySlug(PRODUCT.slug)
    await repository.findBySlug(PRODUCT.slug)
    expect(inner.findBySlug).toHaveBeenCalledTimes(1)

    await bumpCatalogCacheVersion(cache)
    await repository.findBySlug(PRODUCT.slug)
    await repository.listPublishedByGroup('mate')

    expect(inner.findBySlug).toHaveBeenCalledTimes(2)
    expect(set.mock.calls.map(([key]) => key)).toEqual([
      'catalog:v0:products:slug:mate-imperial-premium',
      'catalog:v1:products:slug:mate-imperial-premium',
      'catalog:v1:products:group:mate',
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
