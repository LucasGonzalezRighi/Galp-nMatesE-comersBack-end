/** Configuración de pagos (variables `MP_*` y ajustes de la tienda). */
export interface PaymentsSettings {
  /** `MP_MODE`. */
  mode: 'simulated' | 'live'
  /** `${PUBLIC_API_ORIGIN}/api/v1/webhooks/mercadopago` en `live`; `null` en `simulated`. */
  notificationUrl: string | null
  /** Origen de la tienda (`STORE_ORIGIN`), para las `back_urls`. */
  storeOrigin: string
  /** `MP_STATEMENT_DESCRIPTOR` (13 caracteres máximo). */
  statementDescriptor: string
  /** `MP_WEBHOOK_SECRET`, o `null` (sin secreto toda notificación da 401). */
  webhookSecret: string | null
  /**
   * Máximo de cuotas sin interés de los ajustes (`settings.installmentsMax`).
   *
   * @returns Un entero de 1 a 12.
   */
  maxWithoutInterest(): Promise<number>
}

/** Token de inyección de {@link PaymentsSettings}. */
export const PAYMENTS_SETTINGS = Symbol('PAYMENTS_SETTINGS')
