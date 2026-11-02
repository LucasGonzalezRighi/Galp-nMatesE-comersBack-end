import { Logger, type OnApplicationShutdown } from '@nestjs/common'
import { type ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler'

import { createRateLimitedWarn, errorMessage, type WarnLogger } from '../redis/rate-limited-warn'

/** Estado de un contador (`@nestjs/throttler` no exporta `ThrottlerStorageRecord` desde su raíz). */
type ThrottlerStorageRecord = Awaited<ReturnType<ThrottlerStorage['increment']>>

/** Almacenamiento que libera recursos al apagar la app (como `ThrottlerStorageService`). */
type ShutdownAwareStorage = ThrottlerStorage & OnApplicationShutdown

/**
 * Almacenamiento del rate limiting que **falla abierto**: cuenta en Redis (compartido entre
 * instancias) y, si Redis no responde, cuenta en memoria de esta instancia en vez de lanzar
 * (si lanzara, el guard global convertiría cada pedido en un 500). Avisa por `warn` como mucho
 * una vez por minuto.
 */
export class FailOpenThrottlerStorage implements ThrottlerStorage, OnApplicationShutdown {
  private readonly warn: (message: string) => void

  /**
   * @param primary - Almacenamiento en Redis (`ThrottlerStorageRedisService`).
   * @param fallback - Almacenamiento en memoria para cuando Redis está caído.
   * @param logger - Destino de los avisos (por defecto, el `Logger` de Nest).
   * @param now - Reloj en milisegundos (inyectable para los tests).
   */
  constructor(
    private readonly primary: ThrottlerStorage,
    private readonly fallback: ShutdownAwareStorage = new ThrottlerStorageService(),
    logger: WarnLogger = new Logger(FailOpenThrottlerStorage.name),
    now: () => number = Date.now,
  ) {
    this.warn = createRateLimitedWarn(logger, now)
  }

  /**
   * Suma un pedido al contador de `key` (firma de `ThrottlerStorage` de `@nestjs/throttler`).
   *
   * @returns El estado del contador en Redis o, si Redis falla, en memoria.
   */
  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    try {
      return await this.primary.increment(key, ttl, limit, blockDuration, throttlerName)
    } catch (error) {
      this.warn(`Rate limiting sin Redis (se cuenta en memoria): ${errorMessage(error)}`)
      return this.fallback.increment(key, ttl, limit, blockDuration, throttlerName)
    }
  }

  /** Libera los temporizadores del contador en memoria al apagar la app. */
  onApplicationShutdown(): void {
    void this.fallback.onApplicationShutdown()
  }
}
