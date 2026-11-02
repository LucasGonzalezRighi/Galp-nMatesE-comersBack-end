import { Module } from '@nestjs/common'

import { ConfigModule } from './config/config.module'
import { HealthModule } from './modules/health/health.module'
import { LoggerModule } from './shared/infrastructure/logger/logger.module'
import { PrismaModule } from './shared/infrastructure/prisma/prisma.module'
import { RedisModule } from './shared/infrastructure/redis/redis.module'
import { RateLimitModule } from './shared/infrastructure/throttler/throttler.module'

/** Módulo raíz de la API: junta los módulos de negocio y la infraestructura compartida. */
@Module({
  imports: [ConfigModule, LoggerModule, PrismaModule, RedisModule, RateLimitModule, HealthModule],
})
export class AppModule {}
