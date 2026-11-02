import { Global, Module } from '@nestjs/common'

import { CACHE_PORT } from '../../application/ports/cache.port'
import { SECRETS_PORT, type SecretsPort } from '../../application/ports/secrets.port'
import { SESSION_PORT } from '../../application/ports/session.port'
import { type Clock, CLOCK } from '../../domain/clock'
import { CryptoSecrets } from '../session/crypto-secrets.adapter'
import { RedisSessionStore } from '../session/redis-session.store'
import { RedisCacheAdapter } from './redis-cache.adapter'
import { RedisService } from './redis.service'

/**
 * Redis compartido (global): exporta `RedisService`, el {@link CACHE_PORT} implementado por
 * `RedisCacheAdapter` (falla abierto), el {@link SESSION_PORT} implementado por
 * `RedisSessionStore` (falla cerrado) y el {@link SECRETS_PORT} (`CryptoSecrets`). El reloj
 * (`CLOCK`) lo pone `SharedModule`.
 */
@Global()
@Module({
  providers: [
    RedisService,
    {
      provide: CACHE_PORT,
      useFactory: (redis: RedisService) => new RedisCacheAdapter(redis.client),
      inject: [RedisService],
    },
    { provide: SECRETS_PORT, useClass: CryptoSecrets },
    {
      provide: SESSION_PORT,
      useFactory: (redis: RedisService, secrets: SecretsPort, clock: Clock) =>
        new RedisSessionStore(redis.client, secrets, clock),
      inject: [RedisService, SECRETS_PORT, CLOCK],
    },
  ],
  exports: [RedisService, CACHE_PORT, SECRETS_PORT, SESSION_PORT],
})
export class RedisModule {}
