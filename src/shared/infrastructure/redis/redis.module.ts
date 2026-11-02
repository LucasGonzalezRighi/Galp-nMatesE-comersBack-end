import { Global, Module } from '@nestjs/common'

import { CACHE_PORT } from '../../application/ports/cache.port'
import { RedisCacheAdapter } from './redis-cache.adapter'
import { RedisService } from './redis.service'

/**
 * Redis compartido (global): exporta `RedisService` y el {@link CACHE_PORT} implementado por
 * `RedisCacheAdapter`, que falla abierto.
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
  ],
  exports: [RedisService, CACHE_PORT],
})
export class RedisModule {}
