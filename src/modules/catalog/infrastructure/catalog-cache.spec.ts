import { describe, expect, it } from 'vitest'

import type { CachePort } from '../../../shared/application/ports/cache.port'
import {
  CATALOG_CACHE_TTL_SECONDS,
  CATALOG_CACHE_VERSION_KEY,
  bumpCatalogCacheVersion,
  catalogCacheVersion,
  categoriesCacheKey,
  productGroupCacheKey,
  productListCacheKey,
  productSlugCacheKey,
} from './catalog-cache'

/** Caché en memoria con `get` e `incr` (como Redis: `INCR` guarda el número). */
function memoryCache(): Pick<CachePort, 'get' | 'incr'> & { store: Map<string, unknown> } {
  const store = new Map<string, unknown>()
  return {
    store,
    get: <T>(key: string) => Promise.resolve((store.get(key) ?? null) as T | null),
    incr: (key) => {
      const next = Number(store.get(key) ?? 0) + 1
      store.set(key, next)
      return Promise.resolve(next)
    },
  }
}

describe('claves de la caché del catálogo', () => {
  it('llevan la versión: catalog:v{n}:…', () => {
    expect(productSlugCacheKey('mate-imperial-premium', 3)).toBe(
      'catalog:v3:products:slug:mate-imperial-premium',
    )
    expect(productGroupCacheKey('bombilla', 0)).toBe('catalog:v0:products:group:bombilla')
    expect(categoriesCacheKey(7)).toBe('catalog:v7:categories')
  })

  it('el listado serializa el filtro con un orden fijo de campos', () => {
    const key = productListCacheKey({ sort: 'menor', group: 'mate', page: 1, pageSize: 100 }, 2)

    expect(key).toBe('catalog:v2:products:list:[null,"mate",null,null,"menor",false,1,100]')
    expect(productListCacheKey({ pageSize: 100, page: 1, group: 'mate', sort: 'menor' }, 2)).toBe(
      key,
    )
    expect(
      productListCacheKey({ sort: 'menor', group: 'mate', page: 2, pageSize: 100 }, 2),
    ).not.toBe(key)
  })

  it('una versión que no es un entero de 0 en adelante tira RangeError', () => {
    expect(() => productSlugCacheKey('mate', -1)).toThrow(RangeError)
    expect(() => categoriesCacheKey(1.5)).toThrow(RangeError)
  })

  it('vive 60 s', () => {
    expect(CATALOG_CACHE_TTL_SECONDS).toBe(60)
  })
})

describe('versión de la caché del catálogo', () => {
  it('es 0 sin contador y 1 después de bumpCatalogCacheVersion', async () => {
    const cache = memoryCache()

    await expect(catalogCacheVersion(cache)).resolves.toBe(0)
    await bumpCatalogCacheVersion(cache)
    await expect(catalogCacheVersion(cache)).resolves.toBe(1)
    expect(cache.store.get(CATALOG_CACHE_VERSION_KEY)).toBe(1)
    expect(CATALOG_CACHE_VERSION_KEY).toBe('catalog:version')
  })

  it('un contador ilegible cuenta como 0', async () => {
    const cache = memoryCache()
    cache.store.set(CATALOG_CACHE_VERSION_KEY, 'x')

    await expect(catalogCacheVersion(cache)).resolves.toBe(0)
  })

  it('con la caché caída el bump no lanza (falla abierta)', async () => {
    await expect(
      bumpCatalogCacheVersion({ incr: () => Promise.resolve(null) }),
    ).resolves.toBeUndefined()
  })
})
