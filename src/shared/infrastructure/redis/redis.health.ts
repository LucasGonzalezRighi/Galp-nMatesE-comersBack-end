import { Injectable } from '@nestjs/common'
import { type HealthIndicatorResult, HealthIndicatorService } from '@nestjs/terminus'

import { RedisService } from './redis.service'

/**
 * Indicador de Terminus para Redis (`PING`). Redis no es crítico (la caché y el rate limiting
 * fallan abiertos), así que caído no da `down` sino `degraded`: el health queda en
 * `status: 'degraded'` con HTTP 200 (Review Focus 4).
 */
@Injectable()
export class RedisHealthIndicator {
  constructor(
    private readonly redis: RedisService,
    private readonly health: HealthIndicatorService,
  ) {}

  /**
   * Revisa Redis con un `PING`.
   *
   * @param key - Nombre del indicador en la respuesta (por ejemplo `redis`).
   * @returns `{ [key]: { status: 'up' } }` o, si no responde, `{ [key]: { status: 'degraded', message } }`.
   */
  async isHealthy<const Key extends string>(key: Key): Promise<HealthIndicatorResult<Key>> {
    const indicator = this.health.check(key)
    try {
      await this.redis.ping()
      return indicator.up()
    } catch {
      return indicator.degraded({
        message: 'Redis no responde: la API sigue sin caché ni rate limiting compartido',
      })
    }
  }
}
