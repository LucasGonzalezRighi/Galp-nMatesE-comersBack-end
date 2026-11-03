import { Inject, Injectable } from '@nestjs/common'

import { ENV, type Env } from '../../../config/env'
import { GetStoreSettingsQuery } from '../../settings/application/queries/get-store-settings.query'
import type { PaymentsSettings } from '../application/ports/payments-settings.port'

/** Ruta del webhook de Mercado Pago (con el prefijo `/api/v1`). */
export const WEBHOOK_PATH = '/api/v1/webhooks/mercadopago'

/**
 * Origen del back para las páginas del simulador (Ruling B-55): `PUBLIC_API_ORIGIN` si está, o
 * `http://localhost:${PORT}`.
 *
 * @param env - `PUBLIC_API_ORIGIN` y `PORT`.
 * @returns El origen, sin barra final.
 */
export function simulatorOrigin(env: Pick<Env, 'PUBLIC_API_ORIGIN' | 'PORT'>): string {
  return env.PUBLIC_API_ORIGIN ?? `http://localhost:${String(env.PORT)}`
}

/**
 * {@link PaymentsSettings} desde las variables `MP_*` (Ruling B-47) y los ajustes de la tienda.
 * `notification_url` solo existe en `live`. El secreto del webhook es `MP_WEBHOOK_SECRET` en
 * cualquier modo: sin él toda notificación da 401 (el caso normal de `simulated`), y los E2E lo
 * definen para firmar las suyas.
 */
@Injectable()
export class EnvPaymentsSettings implements PaymentsSettings {
  /** {@inheritDoc PaymentsSettings.mode} */
  readonly mode: PaymentsSettings['mode']
  /** {@inheritDoc PaymentsSettings.notificationUrl} */
  readonly notificationUrl: string | null
  /** {@inheritDoc PaymentsSettings.storeOrigin} */
  readonly storeOrigin: string
  /** {@inheritDoc PaymentsSettings.statementDescriptor} */
  readonly statementDescriptor: string
  /** {@inheritDoc PaymentsSettings.webhookSecret} */
  readonly webhookSecret: string | null
  /** Origen del back para las páginas del simulador (ver {@link simulatorOrigin}). */
  readonly simulatorOrigin: string

  /**
   * @param env - Variables de entorno validadas.
   * @param settings - Ajustes de la tienda (con su caché de 300 s).
   */
  constructor(
    @Inject(ENV) env: Env,
    @Inject(GetStoreSettingsQuery)
    private readonly settings: Pick<GetStoreSettingsQuery, 'execute'>,
  ) {
    this.mode = env.MP_MODE
    this.notificationUrl =
      env.MP_MODE === 'live' && env.PUBLIC_API_ORIGIN !== undefined
        ? `${env.PUBLIC_API_ORIGIN}${WEBHOOK_PATH}`
        : null
    this.storeOrigin = env.STORE_ORIGIN
    this.statementDescriptor = env.MP_STATEMENT_DESCRIPTOR
    this.webhookSecret = env.MP_WEBHOOK_SECRET ?? null
    this.simulatorOrigin = simulatorOrigin(env)
  }

  /** {@inheritDoc PaymentsSettings.maxWithoutInterest} */
  async maxWithoutInterest(): Promise<number> {
    return (await this.settings.execute()).installmentsMax
  }
}
