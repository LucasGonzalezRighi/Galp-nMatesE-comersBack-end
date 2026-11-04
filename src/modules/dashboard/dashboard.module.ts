import { Module } from '@nestjs/common'

import { CLOCK, type Clock } from '../../shared/domain/clock'
import { ExpireOrdersCommand } from '../orders/application/commands/expire-orders.command'
import { OrdersModule } from '../orders/orders.module'
import { DASHBOARD_READER, type DashboardReader } from './application/ports/dashboard-reader.port'
import { GetDashboardSummaryQuery } from './application/queries/get-dashboard-summary.query'
import { PrismaDashboardReader } from './infrastructure/prisma-dashboard.reader'
import { AdminDashboardController } from './interface/admin-dashboard.controller'

/**
 * Resumen del inicio del dashboard (Ruling B-78): un módulo de solo lectura. El lector
 * ({@link PrismaDashboardReader}) lee directo de Postgres las tablas de pedidos, pagos, catálogo,
 * ajustes, reseñas y bandeja (lectura cruzada permitida por el ADR 0001) y de `orders` usa
 * {@link ExpireOrdersCommand} para vencer los atrasados antes de leer. No importa `catalog` ni
 * `media`, no escribe y no avisa a la tienda. El reloj viene del módulo global.
 */
@Module({
  imports: [OrdersModule],
  controllers: [AdminDashboardController],
  providers: [
    { provide: DASHBOARD_READER, useClass: PrismaDashboardReader },
    {
      provide: GetDashboardSummaryQuery,
      useFactory: (reader: DashboardReader, expire: ExpireOrdersCommand, clock: Clock) =>
        new GetDashboardSummaryQuery(reader, expire, clock),
      inject: [DASHBOARD_READER, ExpireOrdersCommand, CLOCK],
    },
  ],
})
export class DashboardModule {}
