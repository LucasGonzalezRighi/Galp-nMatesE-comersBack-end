/**
 * Caché de lecturas (catálogo, contenidos, ajustes) que **falla abierta**: si el almacenamiento
 * no responde, `get` devuelve `null` (como si no hubiera nada guardado) y `set`/`del` no hacen
 * nada, así la lectura sigue desde Postgres. Solo lanza ante argumentos inválidos (errores de
 * programación), nunca porque el almacenamiento esté caído.
 */
export interface CachePort {
  /**
   * Busca un valor guardado.
   *
   * @param key - Clave no vacía.
   * @returns El valor guardado o `null` si no está, venció o el almacenamiento no responde.
   */
  get<T>(key: string): Promise<T | null>

  /**
   * Guarda un valor serializable como JSON durante `ttlSeconds` segundos.
   *
   * @param key - Clave no vacía.
   * @param value - Valor serializable como JSON (no `undefined` ni funciones).
   * @param ttlSeconds - Vida del valor en segundos: entero positivo.
   */
  set(key: string, value: unknown, ttlSeconds: number): Promise<void>

  /**
   * Borra una o más claves (sin claves no hace nada).
   *
   * @param keys - Claves no vacías.
   */
  del(...keys: string[]): Promise<void>
}

/** Token de inyección del {@link CachePort}: `@Inject(CACHE_PORT) cache: CachePort`. */
export const CACHE_PORT = Symbol('CACHE_PORT')
