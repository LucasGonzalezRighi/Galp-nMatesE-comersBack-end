import { Module } from '@nestjs/common'

import { ConfigModule } from './config/config.module'
import { CatalogModule } from './modules/catalog/catalog.module'
import { ContentModule } from './modules/content/content.module'
import { DashboardModule } from './modules/dashboard/dashboard.module'
import { HealthModule } from './modules/health/health.module'
import { IdentityModule } from './modules/identity/identity.module'
import { OrdersModule } from './modules/orders/orders.module'
import { PaymentsModule } from './modules/payments/payments.module'
import { ReviewsModule } from './modules/reviews/reviews.module'
import { SettingsModule } from './modules/settings/settings.module'
import { StorefrontSyncModule } from './modules/storefront-sync/storefront-sync.module'
import { SupportModule } from './modules/support/support.module'
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
    IdentityModule,
    OrdersModule,
    PaymentsModule,
    SupportModule,
    DashboardModule,
    StorefrontSyncModule,
  ],
})
export class AppModule {}
