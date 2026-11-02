import { Controller, Get } from '@nestjs/common'
import { HealthCheck, type HealthCheckResult, HealthCheckService } from '@nestjs/terminus'

import { PrismaHealthIndicator } from '../../../shared/infrastructure/prisma/prisma.health'
import { RedisHealthIndicator } from '../../../shared/infrastructure/redis/redis.health'

/**
 * Expone el estado de la API en `GET /api/v1/health` (Terminus).
 *
 * - Todo bien: HTTP 200 y `status: 'ok'`.
 * - Redis caído: HTTP 200 y `status: 'degraded'` (la caché y el rate limiting fallan abiertos).
 * - Postgres caído (crítico): HTTP 503 y `status: 'error'`, aunque Redis también esté caído.
 */
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly database: PrismaHealthIndicator,
    private readonly redis: RedisHealthIndicator,
  ) {}

  /**
   * Revisa las dependencias de la API.
   *
   * @returns El resultado de Terminus: `status`, `info`, `error` y `details` por indicador
   *   (`database` y `redis`).
   */
  @Get()
  @HealthCheck()
  check(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.database.isHealthy('database'),
      () => this.redis.isHealthy('redis'),
    ])
  }
}
