import { BullModule } from '@nestjs/bullmq'
import { Module } from '@nestjs/common'

import { ENV, type Env } from '../../config/env'
import { STOREFRONT_PORT } from './application/ports/storefront.port'
import { HttpStorefrontAdapter } from './infrastructure/http-storefront.adapter'
import { STOREFRONT_REVALIDATE_QUEUE } from './infrastructure/storefront-revalidate.queue'
import { StorefrontRevalidateProcessor } from './infrastructure/storefront-revalidate.processor'
import { StorefrontOutboxHandler } from './infrastructure/storefront.outbox-handler'

/**
 * Aviso a la tienda (spec §3.2): cuando un evento del outbox cambia algo que la tienda cachea
 * (hoy `combo.changed` → etiqueta `combos`), {@link StorefrontOutboxHandler} encola un job en
 * `storefront-revalidate` y {@link StorefrontRevalidateProcessor} hace
 * `POST ${STORE_ORIGIN}/api/revalidate` con `x-revalidate-secret` (`STORE_REVALIDATE_SECRET`).
 * La escritura que originó el evento nunca espera a la tienda. La cola usa
 * `enableOfflineQueue: false`, como las demás.
 */
@Module({
  imports: [
    BullModule.registerQueueAsync({
      name: STOREFRONT_REVALIDATE_QUEUE,
      inject: [ENV],
      useFactory: (env: Env) => ({
        connection: { url: env.REDIS_URL, enableOfflineQueue: false },
      }),
    }),
  ],
  providers: [
    {
      provide: STOREFRONT_PORT,
      useFactory: (env: Env) =>
        new HttpStorefrontAdapter({
          storeOrigin: env.STORE_ORIGIN,
          secret: env.STORE_REVALIDATE_SECRET,
        }),
      inject: [ENV],
    },
    StorefrontOutboxHandler,
    StorefrontRevalidateProcessor,
  ],
})
export class StorefrontSyncModule {}
