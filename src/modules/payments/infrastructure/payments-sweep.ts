import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common'

import { ENV, type Env } from '../../../config/env'
import { errorMessage } from '../../../shared/infrastructure/redis/rate-limited-warn'
import {
  EXPIRE_BATCH_SIZE,
  ExpireOrdersCommand,
} from '../../orders/application/commands/expire-orders.command'
import {
  type ReconcileResult,
  ReconcilePendingPaymentsCommand,
} from '../application/commands/reconcile-pending-payments.command'
import {
  type ReprocessResult,
  ReprocessWebhookEventsCommand,
} from '../application/commands/reprocess-webhook-events.command'

/** Cada cuánto corre el barrido de pagos. */
export const PAYMENTS_SWEEP_INTERVAL_MS = 60_000

/** Lo que hizo una vuelta del barrido. */
export interface PaymentsSweepResult {
  /** Pedidos vencidos por `expireDue`. */
  expired: number
  /** Conciliación de pagos en curso. */
  reconcile: ReconcileResult
  /** Notificaciones retomadas. */
  reprocess: ReprocessResult
}

/**
 * Barrido de pagos (Rulings B-42 y de la revisión de la ola 2-3): cada
 * {@link PAYMENTS_SWEEP_INTERVAL_MS} vence los pedidos atrasados (`expireDue`, idempotente con el
 * barrido de pedidos), concilia los pagos en curso ({@link ReconcilePendingPaymentsCommand}, que
 * vence en la misma pasada lo que cancela) y retoma las notificaciones sin procesar
 * ({@link ReprocessWebhookEventsCommand}, en línea), en ese orden. Cada paso está aislado: si uno
 * falla, se avisa y siguen los demás.
 *
 * Con `NODE_ENV=test` el temporizador no arranca: los E2E llaman a {@link runOnce} a mano.
 */
@Injectable()
export class PaymentsSweep implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PaymentsSweep.name)
  private timer: NodeJS.Timeout | undefined
  private running: Promise<PaymentsSweepResult> | undefined

  /**
   * @param expire - Vencimiento de pedidos.
   * @param reconcile - Conciliación de pagos en curso.
   * @param reprocess - Notificaciones sin procesar.
   * @param env - Variables de entorno validadas (para no arrancar en test).
   */
  constructor(
    @Inject(ExpireOrdersCommand) private readonly expire: ExpireOrdersCommand,
    @Inject(ReconcilePendingPaymentsCommand)
    private readonly reconcile: ReconcilePendingPaymentsCommand,
    @Inject(ReprocessWebhookEventsCommand)
    private readonly reprocess: ReprocessWebhookEventsCommand,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Arranca el temporizador, salvo con `NODE_ENV=test`. */
  onModuleInit(): void {
    if (this.env.NODE_ENV === 'test') return
    this.timer = setInterval(() => {
      void this.runOnce()
    }, PAYMENTS_SWEEP_INTERVAL_MS)
  }

  /** Detiene el temporizador y espera la vuelta en curso, si la hay. */
  async onModuleDestroy(): Promise<void> {
    clearInterval(this.timer)
    this.timer = undefined
    await this.running
  }

  /**
   * Corre una vuelta. Si ya hay una en curso, devuelve esa. Nunca lanza: un paso que falla se
   * avisa con `warn` y cuenta en cero.
   *
   * @returns Lo que hizo cada paso.
   */
  runOnce(): Promise<PaymentsSweepResult> {
    this.running ??= this.sweep().finally(() => {
      this.running = undefined
    })
    return this.running
  }

  private async sweep(): Promise<PaymentsSweepResult> {
    const expired = await this.step('vencer los pedidos atrasados', 0, async () => {
      return (await this.expire.expireDue(EXPIRE_BATCH_SIZE)).expired
    })
    const reconcile = await this.step(
      'conciliar los pagos en curso',
      { reconciled: 0, expired: 0, failed: 0 },
      () => this.reconcile.execute(),
    )
    const reprocess = await this.step(
      'retomar las notificaciones sin procesar',
      { processed: 0, failed: 0 },
      () => this.reprocess.execute(),
    )
    return { expired, reconcile, reprocess }
  }

  private async step<T>(label: string, fallback: T, run: () => Promise<T>): Promise<T> {
    try {
      return await run()
    } catch (error: unknown) {
      // Corre una vez por minuto: cada paso avisa a lo sumo una vez por vuelta.
      this.logger.warn(`El barrido de pagos no pudo ${label}: ${errorMessage(error)}`)
      return fallback
    }
  }
}
