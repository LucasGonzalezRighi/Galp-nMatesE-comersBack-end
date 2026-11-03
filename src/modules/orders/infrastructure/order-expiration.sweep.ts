import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common'

import { ENV, type Env } from '../../../config/env'
import {
  createRateLimitedWarn,
  errorMessage,
} from '../../../shared/infrastructure/redis/rate-limited-warn'
import {
  EXPIRE_BATCH_SIZE,
  ExpireOrdersCommand,
} from '../application/commands/expire-orders.command'

/** Cada cuánto corre el barrido de pedidos vencidos. */
export const ORDER_EXPIRATION_SWEEP_INTERVAL_MS = 60_000

/**
 * Barrido de pedidos vencidos: cada {@link ORDER_EXPIRATION_SWEEP_INTERVAL_MS} vence hasta 50
 * pedidos atrasados (por si un job de la cola se perdió o Redis estaba caído al crearlos).
 *
 * Con `NODE_ENV=test` el temporizador no arranca: los E2E llaman a {@link runOnce} a mano.
 */
@Injectable()
export class OrderExpirationSweep implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OrderExpirationSweep.name)
  private readonly warn = createRateLimitedWarn(this.logger)
  private timer: NodeJS.Timeout | undefined
  private running: Promise<number> | undefined

  /**
   * @param expire - Vencimiento de pedidos.
   * @param env - Variables de entorno validadas (para no arrancar en test).
   */
  constructor(
    @Inject(ExpireOrdersCommand) private readonly expire: ExpireOrdersCommand,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Arranca el temporizador, salvo con `NODE_ENV=test`. */
  onModuleInit(): void {
    if (this.env.NODE_ENV === 'test') return
    this.timer = setInterval(() => {
      void this.runOnce()
    }, ORDER_EXPIRATION_SWEEP_INTERVAL_MS)
  }

  /** Detiene el temporizador y espera la vuelta en curso, si la hay. */
  async onModuleDestroy(): Promise<void> {
    clearInterval(this.timer)
    this.timer = undefined
    await this.running
  }

  /**
   * Vence una tanda de pedidos atrasados. Si ya hay una vuelta en curso, devuelve esa. Nunca
   * lanza: los fallos se avisan con `warn` y la vuelta cuenta 0.
   *
   * @returns Cuántos pedidos venció.
   */
  runOnce(): Promise<number> {
    this.running ??= this.expire
      .expireDue(EXPIRE_BATCH_SIZE)
      .catch((error: unknown) => {
        this.warn(`No se pudieron vencer los pedidos atrasados: ${errorMessage(error)}`)
        return 0
      })
      .finally(() => {
        this.running = undefined
      })
    return this.running
  }
}
