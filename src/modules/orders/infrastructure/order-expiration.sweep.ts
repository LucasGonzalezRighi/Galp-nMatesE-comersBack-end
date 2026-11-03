import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common'

import { ENV, type Env } from '../../../config/env'
import {
  createRateLimitedWarn,
  errorMessage,
} from '../../../shared/infrastructure/redis/rate-limited-warn'
import {
  EXPIRE_BATCH_SIZE,
  type ExpireFailure,
  ExpireOrdersCommand,
} from '../application/commands/expire-orders.command'

/** Cada cuánto corre el barrido de pedidos vencidos. */
export const ORDER_EXPIRATION_SWEEP_INTERVAL_MS = 60_000

/** Cuántos pedidos fallidos se detallan en el aviso del barrido. */
const FAILURES_IN_WARNING = 5

/** Aviso con los pedidos que no se pudieron vencer (los primeros, con su motivo). */
function failuresMessage(failed: readonly ExpireFailure[]): string {
  const detailed = failed
    .slice(0, FAILURES_IN_WARNING)
    .map((failure) => `${failure.number}: ${errorMessage(failure.error)}`)
    .join('; ')
  const rest = failed.length - FAILURES_IN_WARNING
  const more = rest > 0 ? ` (y ${String(rest)} más)` : ''
  return `No se pudieron vencer ${String(failed.length)} pedidos atrasados: ${detailed}${more}`
}

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
   * lanza: si no se pudo ni buscar los atrasados, avisa con `warn` y la vuelta cuenta 0; si
   * algún pedido no se pudo vencer, avisa cuáles y cuenta los que sí.
   *
   * @returns Cuántos pedidos venció.
   */
  runOnce(): Promise<number> {
    this.running ??= this.expire
      .expireDue(EXPIRE_BATCH_SIZE)
      .then((result) => {
        if (result.failed.length > 0) this.warn(failuresMessage(result.failed))
        return result.expired
      })
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
