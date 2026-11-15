import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis'
import { Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler'

import { RedisModule } from '../redis/redis.module'
import { RedisService } from '../redis/redis.service'
import { FailOpenThrottlerStorage } from './fail-open-throttler.storage'
import { skipWithoutKnownClientIp } from './client-rate-limit'

/**
 * Límite por defecto de las rutas públicas: 120 pedidos por minuto por IP (`req.ip`: la del
 * cliente con `TRUST_PROXY`; sin él, la del socket, que detrás de la tienda es la de su servidor).
 */
export const PUBLIC_RATE_LIMIT = { ttl: 60_000, limit: 120 } as const

/** Mensaje del 429 (el filtro `problem+json` de la Task 5 lo pone en `detail`). */
export const RATE_LIMIT_MESSAGE = 'Demasiados pedidos seguidos: esperá un minuto y probá de nuevo.'

/**
 * Rate limiting global con `@nestjs/throttler`: guard en todas las rutas
 * ({@link PUBLIC_RATE_LIMIT}, por IP), contadores en Redis compartidos entre instancias y, si
 * Redis se cae, en memoria ({@link FailOpenThrottlerStorage}). Las rutas sensibles (login,
 * formularios, pedidos) ajustan su límite con `@Throttle` y las que no deben limitarse usan
 * `@SkipThrottle`. Las lecturas públicas (`@PublicRead()`, NV-18) y las rutas de pago (NV-16)
 * llevan su propio límite (`@ClientRateLimit()`), que solo cuenta cuando se conoce la IP real del
 * cliente (`skipIf`): sin `TRUST_PROXY`, o cuando pide el servidor de la tienda, no se limitan.
 */
@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      imports: [RedisModule],
      inject: [RedisService],
      useFactory: (redis: RedisService) => ({
        throttlers: [PUBLIC_RATE_LIMIT],
        skipIf: skipWithoutKnownClientIp,
        storage: new FailOpenThrottlerStorage(new ThrottlerStorageRedisService(redis.client)),
        errorMessage: RATE_LIMIT_MESSAGE,
      }),
    }),
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class RateLimitModule {}
