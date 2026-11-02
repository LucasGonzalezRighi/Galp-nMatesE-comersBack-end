import { Controller, Get } from '@nestjs/common'
import { HealthCheck, type HealthCheckResult, HealthCheckService } from '@nestjs/terminus'

import { RedisHealthIndicator } from '../../../shared/infrastructure/redis/redis.health'

/**
 * Expone el estado de la API en `GET /api/v1/health` (Terminus).
 *
 * - Todo bien: HTTP 200 y `status: 'ok'`.
 * - Redis caído: HTTP 200 y `status: 'degraded'` (la caché y el rate limiting fallan abiertos).
 * - Un indicador crítico caído (Postgres, cuando se sume): HTTP 503 y `status: 'error'`.
 *
 * Por ahora solo revisa Redis: el indicador de Postgres (`SELECT 1` con `PrismaService`) lo suma
 * la ola siguiente.
 */
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly redis: RedisHealthIndicator,
  ) {}

  /**
   * Revisa las dependencias de la API.
   *
   * @returns El resultado de Terminus: `status`, `info`, `error` y `details` por indicador.
   */
  @Get()
  @HealthCheck()
  check(): Promise<HealthCheckResult> {
    return this.health.check([() => this.redis.isHealthy('redis')])
  }
}
