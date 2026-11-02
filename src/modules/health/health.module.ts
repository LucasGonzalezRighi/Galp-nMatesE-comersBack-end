import { Module } from '@nestjs/common'
import { TerminusModule } from '@nestjs/terminus'

import { RedisHealthIndicator } from '../../shared/infrastructure/redis/redis.health'
import { RedisModule } from '../../shared/infrastructure/redis/redis.module'
import { HealthController } from './interface/health.controller'

/** Módulo de salud de la API: `GET /api/v1/health` con Terminus. */
@Module({
  imports: [TerminusModule, RedisModule],
  controllers: [HealthController],
  providers: [RedisHealthIndicator],
})
export class HealthModule {}
