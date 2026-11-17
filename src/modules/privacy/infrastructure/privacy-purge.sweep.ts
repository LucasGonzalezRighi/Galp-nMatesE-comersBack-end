import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common'

import { ENV, type Env } from '../../../config/env'
import { CLOCK, type Clock } from '../../../shared/domain/clock'
import {
  createRateLimitedWarn,
  errorMessage,
} from '../../../shared/infrastructure/redis/rate-limited-warn'
import {
  PurgeExpiredDataCommand,
  type PurgeSummary,
} from '../application/purge-expired-data.command'

/** Cada cuánto corre la purga de datos personales: una vez por día. */
export const PRIVACY_PURGE_INTERVAL_MS = 24 * 60 * 60 * 1_000

/** Cuánto espera la primera vuelta después de arrancar (para no depender de un día sin reinicios). */
export const PRIVACY_PURGE_FIRST_RUN_MS = 5 * 60 * 1_000

/** Línea del log con las cantidades borradas (nunca datos de las filas). */
export function purgeSummaryMessage(summary: PurgeSummary): string {
  return (
    `Purga de datos personales: ${String(summary.idempotencyKeys)} claves de idempotencia, ` +
    `${String(summary.passwordResetTokens)} tokens de contraseña, ` +
    `${String(summary.contactMessages)} mensajes de contacto, ` +
    `${String(summary.webhookEvents)} eventos de webhook, ` +
    `${String(summary.outboxEvents)} eventos del outbox y ${String(summary.reviews)} reseñas`
  )
}

/**
 * Barrido diario de datos personales vencidos (LS-5): corre {@link PurgeExpiredDataCommand} a los
 * {@link PRIVACY_PURGE_FIRST_RUN_MS} de arrancar y después cada {@link PRIVACY_PURGE_INTERVAL_MS},
 * y loguea solo cantidades.
 *
 * Con `NODE_ENV=test` el temporizador no arranca: los E2E llaman a {@link runOnce} a mano.
 */
@Injectable()
export class PrivacyPurgeSweep implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrivacyPurgeSweep.name)
  private readonly warn = createRateLimitedWarn(this.logger)
  private firstRun: NodeJS.Timeout | undefined
  private timer: NodeJS.Timeout | undefined
  private running: Promise<PurgeSummary | undefined> | undefined

  /**
   * @param purge - La purga.
   * @param clock - El reloj de la app.
   * @param env - Variables de entorno validadas (para no arrancar en test).
   */
  constructor(
    @Inject(PurgeExpiredDataCommand) private readonly purge: PurgeExpiredDataCommand,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Programa la primera vuelta y la diaria, salvo con `NODE_ENV=test`. */
  onModuleInit(): void {
    if (this.env.NODE_ENV === 'test') return
    this.firstRun = setTimeout(() => {
      void this.runOnce()
    }, PRIVACY_PURGE_FIRST_RUN_MS)
    this.timer = setInterval(() => {
      void this.runOnce()
    }, PRIVACY_PURGE_INTERVAL_MS)
  }

  /** Detiene los temporizadores y espera la vuelta en curso, si la hay. */
  async onModuleDestroy(): Promise<void> {
    clearTimeout(this.firstRun)
    clearInterval(this.timer)
    this.firstRun = undefined
    this.timer = undefined
    await this.running
  }

  /**
   * Corre una purga. Si ya hay una en curso, devuelve esa. Nunca lanza: si falla, avisa con
   * `warn` y devuelve `undefined` (lo ya borrado queda borrado; la vuelta siguiente sigue).
   *
   * @returns Lo que borró, o `undefined` si falló.
   */
  runOnce(): Promise<PurgeSummary | undefined> {
    this.running ??= this.purge
      .execute(this.clock.now())
      .then((summary): PurgeSummary => {
        this.logger.log(purgeSummaryMessage(summary))
        return summary
      })
      .catch((error: unknown) => {
        this.warn(`No se pudo purgar los datos personales vencidos: ${errorMessage(error)}`)
        return undefined
      })
      .finally(() => {
        this.running = undefined
      })
    return this.running
  }
}
