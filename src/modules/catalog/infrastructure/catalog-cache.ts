import type { CachePort } from '../../../shared/application/ports/cache.port'
import type { ProductGroup } from '../domain/category.entity'
import type { ProductFilter } from '../application/ports/product.repository.port'

/** Vida de las lecturas del catálogo en la caché (claves `catalog:v{n}:*`). */
export const CATALOG_CACHE_TTL_SECONDS = 60

/**
 * Contador de la versión de la caché del catálogo: cada escritura del catálogo (productos, líneas,
 * moderación de reseñas) le suma 1 después del commit y las claves viejas quedan huérfanas hasta
 * que vencen (las de los listados no se pueden enumerar para borrarlas).
 */
export const CATALOG_CACHE_VERSION_KEY = 'catalog:version'

/**
 * Prefijo de las claves de una versión.
 *
 * @throws {RangeError} En español, si la versión no es un entero de 0 en adelante.
 */
function versionPrefix(version: number): string {
  if (!Number.isInteger(version) || version < 0) {
    throw new RangeError(
      `La versión de la caché del catálogo es un entero de 0 en adelante (llegó ${String(version)})`,
    )
  }
  return `catalog:v${String(version)}`
}

/**
 * Versión vigente de la caché del catálogo. Se lee en cada lectura cacheada y, en los pedidos,
 * después del commit (si se leyera antes, un bump en el medio dejaría la versión nueva con el
 * stock viejo).
 *
 * @param cache - Caché de lecturas (falla abierta).
 * @returns El contador, o 0 si no existe, no es un entero o la caché no responde.
 */
export async function catalogCacheVersion(cache: Pick<CachePort, 'get'>): Promise<number> {
  const version = await cache.get<unknown>(CATALOG_CACHE_VERSION_KEY)
  return typeof version === 'number' && Number.isInteger(version) && version >= 0 ? version : 0
}

/**
 * Pasa la caché del catálogo a una versión nueva: las lecturas siguientes van a Postgres. Va
 * después del commit de cada escritura del catálogo. Con la caché caída no hace nada (las claves
 * viejas vencen solas en {@link CATALOG_CACHE_TTL_SECONDS}).
 *
 * @param cache - Caché de lecturas (falla abierta).
 */
export async function bumpCatalogCacheVersion(cache: Pick<CachePort, 'incr'>): Promise<void> {
  await cache.incr(CATALOG_CACHE_VERSION_KEY)
}

/**
 * Clave de la ficha de un producto (también bajo un slug anterior).
 *
 * @param slug - Slug pedido.
 * @param version - Versión de {@link catalogCacheVersion}.
 * @returns `catalog:v{version}:products:slug:{slug}` (la borra `orders` al cambiar el stock).
 * @throws {RangeError} En español, si la versión no es un entero de 0 en adelante.
 */
export function productSlugCacheKey(slug: string, version: number): string {
  return `${versionPrefix(version)}:products:slug:${slug}`
}

/**
 * Clave de los productos publicados de un grupo (piezas del armador de kits).
 *
 * @param group - Grupo del producto.
 * @param version - Versión de {@link catalogCacheVersion}.
 * @returns `catalog:v{version}:products:group:{group}` (la borra `orders` al cambiar el stock).
 * @throws {RangeError} En español, si la versión no es un entero de 0 en adelante.
 */
export function productGroupCacheKey(group: ProductGroup, version: number): string {
  return `${versionPrefix(version)}:products:group:${group}`
}

/**
 * Clave de un listado de productos: el filtro serializado con un orden de campos fijo, para que
 * dos filtros iguales den la misma clave.
 *
 * @param filter - Filtro ya normalizado (los listados por `ids` no se cachean).
 * @param version - Versión de {@link catalogCacheVersion}.
 * @returns `catalog:v{version}:products:list:{filtro en JSON}`.
 * @throws {RangeError} En español, si la versión no es un entero de 0 en adelante.
 */
export function productListCacheKey(filter: ProductFilter, version: number): string {
  const parts = [
    filter.category ?? null,
    filter.group ?? null,
    filter.ids ?? null,
    filter.q ?? null,
    filter.sort,
    filter.featured ?? false,
    filter.page,
    filter.pageSize,
  ]
  return `${versionPrefix(version)}:products:list:${JSON.stringify(parts)}`
}

/**
 * Clave de las líneas.
 *
 * @param version - Versión de {@link catalogCacheVersion}.
 * @returns `catalog:v{version}:categories`.
 * @throws {RangeError} En español, si la versión no es un entero de 0 en adelante.
 */
export function categoriesCacheKey(version: number): string {
  return `${versionPrefix(version)}:categories`
}
