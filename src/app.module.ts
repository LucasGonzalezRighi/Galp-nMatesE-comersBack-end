import { Module } from '@nestjs/common'

import { ConfigModule } from './config/config.module'
import { CatalogModule } from './modules/catalog/catalog.module'
import { ContentModule } from './modules/content/content.module'
import { HealthModule } from './modules/health/health.module'
import { ReviewsModule } from './modules/reviews/reviews.module'
import { SettingsModule } from './modules/settings/settings.module'
import { LoggerModule } from './shared/infrastructure/logger/logger.module'
import { PrismaModule } from './shared/infrastructure/prisma/prisma.module'
import { RedisModule } from './shared/infrastructure/redis/redis.module'
import { RateLimitModule } from './shared/infrastructure/throttler/throttler.module'
import { SharedModule } from './shared/shared.module'

/** Módulo raíz de la API: junta los módulos de negocio y la infraestructura compartida. */
@Module({
  imports: [
    ConfigModule,
    LoggerModule,
    PrismaModule,
    RedisModule,
    RateLimitModule,
    SharedModule,
    HealthModule,
    SettingsModule,
    ContentModule,
    CatalogModule,
    ReviewsModule,
  ],
})
export class AppModule {}
