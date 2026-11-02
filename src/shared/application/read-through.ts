import type { CachePort } from './ports/cache.port'

/**
 * Lee un valor de la caché y, si no está, lo carga y lo guarda ("read-through").
 *
 * Como el {@link CachePort} falla abierto, con el almacenamiento caído siempre carga desde la
 * fuente. Un `null` cargado no se guarda (el puerto no distingue "guardé null" de "no hay nada"):
 * así un faltante no queda cacheado.
 *
 * @param cache - Caché de lecturas.
 * @param key - Clave no vacía (por ejemplo `catalog:products:slug:mate-imperial-premium`).
 * @param ttlSeconds - Vida del valor en segundos (entero positivo).
 * @param load - Carga el valor desde la fuente; tiene que ser serializable como JSON.
 * @returns El valor guardado o el recién cargado.
 */
export async function readThrough<T>(
  cache: CachePort,
  key: string,
  ttlSeconds: number,
  load: () => Promise<T>,
): Promise<T> {
  const cached = await cache.get<T>(key)
  if (cached !== null) return cached
  const value = await load()
  if (value !== null) await cache.set(key, value, ttlSeconds)
  return value
}
