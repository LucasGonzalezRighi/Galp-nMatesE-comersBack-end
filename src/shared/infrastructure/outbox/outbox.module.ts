import { BullModule } from '@nestjs/bullmq'
import { Module } from '@nestjs/common'

import { ENV, type Env } from '../../../config/env'
import { OUTBOX_QUEUE, OutboxRelay } from './outbox.relay'
import { OutboxRepository } from './outbox.repository'

/**
 * Outbox de eventos de dominio: `OutboxRepository` para guardarlos en la transacción y
 * `OutboxRelay` para publicarlos en la cola BullMQ `outbox`.
 *
 * Acá vive la conexión raíz de BullMQ (`REDIS_URL`, propia: no reusa la de `RedisService`); las
 * colas de B3/B4 se registran con `BullModule.registerQueue`. La cola `outbox` es solo productora
 * y usa `enableOfflineQueue: false`: con Redis caído, `add` falla al instante (el evento queda
 * pendiente) y el cierre de la app no espera a que Redis vuelva.
 */
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({ connection: { url: env.REDIS_URL } }),
    }),
    BullModule.registerQueueAsync({
      name: OUTBOX_QUEUE,
      inject: [ENV],
      useFactory: (env: Env) => ({
        connection: { url: env.REDIS_URL, enableOfflineQueue: false },
      }),
    }),
  ],
  providers: [OutboxRepository, OutboxRelay],
  exports: [OutboxRepository, OutboxRelay],
})
export class OutboxModule {}
