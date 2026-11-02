import { Module } from '@nestjs/common'

import { HealthModule } from './modules/health/health.module'

/** Módulo raíz de la API: junta los módulos de negocio y la infraestructura compartida. */
@Module({ imports: [HealthModule] })
export class AppModule {}
