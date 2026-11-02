import { Module } from '@nestjs/common'

import { ConfigModule } from './config/config.module'
import { HealthModule } from './modules/health/health.module'
import { LoggerModule } from './shared/infrastructure/logger/logger.module'

/** Módulo raíz de la API: junta los módulos de negocio y la infraestructura compartida. */
@Module({ imports: [ConfigModule, LoggerModule, HealthModule] })
export class AppModule {}
