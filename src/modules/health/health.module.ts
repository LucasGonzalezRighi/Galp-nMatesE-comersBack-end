import { Module } from '@nestjs/common'

import { HealthController } from './interface/health.controller'

/** Módulo de salud de la API: `GET /api/v1/health`. */
@Module({ controllers: [HealthController] })
export class HealthModule {}
