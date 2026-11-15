import { Logger } from '@nestjs/common'

import {
  createRateLimitedWarn,
  errorMessage,
  type WarnLogger,
} from '../../../shared/infrastructure/redis/rate-limited-warn'
import type { ReviewQuotaPort } from '../application/ports/review-quota.port'
import {
  MAX_PENDING_REVIEWS_PER_IP,
  REVIEW_QUOTA_WINDOW_SECONDS,
} from '../domain/review-moderation'

/** Lo que el cupo usa de ioredis (para poder probarlo con un doble). */
export interface ReviewQuotaRedisClient {
  /** `INCR key`: suma 1 y devuelve el valor nuevo. */
  incr(key: string): Promise<number>
  /** `EXPIRE key seconds NX`: pone el vencimiento solo si no tiene. */
  expire(key: string, seconds: number, mode: 'NX'): Promise<number>
  /** `TTL key`: segundos que le quedan (negativo si no vence o no existe). */
  ttl(key: string): Promise<number>
}

/**
 * Cupo diario de reseñas por IP en Redis (NV-21): `review-quota:{ip}` con `INCR` y un vencimiento
 * de un día desde la primera reseña. Falla abierto: con Redis caído deja pasar (queda el límite
 * por IP de la ruta) y avisa por `warn` como mucho una vez por minuto.
 */
export class RedisReviewQuota implements ReviewQuotaPort {
  private readonly warn: (message: string) => void

  /**
   * @param redis - Cliente de Redis (el de `RedisService`).
   * @param logger - Destino de los avisos (por defecto, el `Logger` de Nest).
   * @param now - Reloj en milisegundos (para el aviso limitado; inyectable en los tests).
   */
  constructor(
    private readonly redis: ReviewQuotaRedisClient,
    logger: WarnLogger = new Logger(RedisReviewQuota.name),
    now: () => number = Date.now,
  ) {
    this.warn = createRateLimitedWarn(logger, now)
  }

  /** {@inheritDoc ReviewQuotaPort.take} */
  async take(clientIp: string): Promise<number | null> {
    if (clientIp.trim() === '') throw new TypeError('La IP del cliente no puede estar vacía')
    const key = `review-quota:${encodeURIComponent(clientIp)}`
    try {
      const count = await this.redis.incr(key)
      await this.redis.expire(key, REVIEW_QUOTA_WINDOW_SECONDS, 'NX')
      if (count <= MAX_PENDING_REVIEWS_PER_IP) return null
      const remaining = await this.redis.ttl(key)
      return remaining > 0 ? remaining : REVIEW_QUOTA_WINDOW_SECONDS
    } catch (error) {
      this.warn(`Cupo de reseñas sin Redis (se deja pasar): ${errorMessage(error)}`)
      return null
    }
  }
}
