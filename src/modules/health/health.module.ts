import { Module } from '@nestjs/common'
import { TerminusModule } from '@nestjs/terminus'

import { PrismaHealthIndicator } from '../../shared/infrastructure/prisma/prisma.health'
import { PrismaModule } from '../../shared/infrastructure/prisma/prisma.module'
import { RedisHealthIndicator } from '../../shared/infrastructure/redis/redis.health'
import { RedisModule } from '../../shared/infrastructure/redis/redis.module'
import { HealthController } from './interface/health.controller'

/** Módulo de salud de la API: `GET /api/v1/health` con Terminus (Postgres y Redis). */
@Module({
  imports: [TerminusModule, PrismaModule, RedisModule],
  controllers: [HealthController],
  providers: [PrismaHealthIndicator, RedisHealthIndicator],
})
export class HealthModule {}
