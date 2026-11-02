import { Global, Module } from '@nestjs/common'
import { APP_INTERCEPTOR } from '@nestjs/core'

import { CLOCK, SystemClock } from './domain/clock'
import { IdempotencyInterceptor } from './infrastructure/idempotency/idempotency.interceptor'
import {
  IDEMPOTENCY_REPOSITORY,
  PrismaIdempotencyRepository,
} from './infrastructure/idempotency/idempotency.repository'
import { OutboxModule } from './infrastructure/outbox/outbox.module'

/**
 * Núcleo compartido, global: reloj (`CLOCK`), claves de idempotencia en Postgres con su
 * interceptor (activo solo en las rutas con `@Idempotent`) y el outbox (`OutboxRepository`,
 * `OutboxRelay`). El filtro `problem+json` y el pipe de validación se registran en `setupApp`.
 */
@Global()
@Module({
  imports: [OutboxModule],
  providers: [
    { provide: CLOCK, useValue: new SystemClock() },
    { provide: IDEMPOTENCY_REPOSITORY, useClass: PrismaIdempotencyRepository },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
  ],
  exports: [CLOCK, IDEMPOTENCY_REPOSITORY, OutboxModule],
})
export class SharedModule {}
