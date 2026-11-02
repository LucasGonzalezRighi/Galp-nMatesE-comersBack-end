import { Logger } from '@nestjs/common'

import type { CachePort } from '../../application/ports/cache.port'
import { createRateLimitedWarn, errorMessage, type WarnLogger } from './rate-limited-warn'

/** Los tres comandos de ioredis que usa la caché (un `Redis` de ioredis lo cumple). */
export interface RedisCacheClient {
  /** `GET key`: el texto guardado o `null`. */
  get(key: string): Promise<string | null>
  /** `SET key value EX seconds`. */
  set(key: string, value: string, secondsToken: 'EX', seconds: number): Promise<unknown>
  /** `DEL key [key ...]`: cuántas claves borró. */
  del(...keys: string[]): Promise<number>
}

/**
 * {@link CachePort} sobre Redis que **nunca lanza por fallas de Redis**: si un comando falla,
 * `get` devuelve `null`, `set`/`del` no hacen nada y se avisa por `warn` como mucho una vez por
 * minuto. Los valores se guardan como JSON.
 */
export class RedisCacheAdapter implements CachePort {
  private readonly warn: (message: string) => void

  /**
   * @param redis - Cliente de Redis (el de `RedisService`).
   * @param logger - Destino de los avisos (por defecto, el `Logger` de Nest).
   * @param now - Reloj en milisegundos (inyectable para los tests).
   */
  constructor(
    private readonly redis: RedisCacheClient,
    logger: WarnLogger = new Logger(RedisCacheAdapter.name),
    now: () => number = Date.now,
  ) {
    this.warn = createRateLimitedWarn(logger, now)
  }

  /** {@inheritDoc CachePort.get} */
  async get<T>(key: string): Promise<T | null> {
    assertKey(key)
    let raw: string | null
    try {
      raw = await this.redis.get(key)
    } catch (error) {
      this.warn(`Caché sin Redis (se lee de la base): ${errorMessage(error)}`)
      return null
    }
    if (raw === null) return null
    try {
      return JSON.parse(raw) as T
    } catch (error) {
      this.warn(`Valor de caché ilegible en "${key}" (se ignora): ${errorMessage(error)}`)
      return null
    }
  }

  /** {@inheritDoc CachePort.set} */
  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    assertKey(key)
    if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) {
      throw new Error(
        `El TTL de caché tiene que ser un entero positivo de segundos (llegó ${String(ttlSeconds)})`,
      )
    }
    try {
      await this.redis.set(key, JSON.stringify(value), 'EX', ttlSeconds)
    } catch (error) {
      this.warn(`Caché sin Redis (no se guarda "${key}"): ${errorMessage(error)}`)
    }
  }

  /** {@inheritDoc CachePort.del} */
  async del(...keys: string[]): Promise<void> {
    keys.forEach(assertKey)
    if (keys.length === 0) return
    try {
      await this.redis.del(...keys)
    } catch (error) {
      this.warn(
        `Caché sin Redis (no se borran ${String(keys.length)} claves): ${errorMessage(error)}`,
      )
    }
  }
}

function assertKey(key: string): void {
  if (key.trim() === '') throw new Error('La clave de caché no puede estar vacía')
}
