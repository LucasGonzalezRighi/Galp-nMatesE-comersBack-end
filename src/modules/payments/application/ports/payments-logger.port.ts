/**
 * Avisos de los casos de uso de pagos (estado desconocido de Mercado Pago, pago sin pedido,
 * devolución fallida, cancelación de mejor esfuerzo que no anduvo). En infraestructura es un
 * `Logger` de Nest; nunca recibe el token de la tarjeta ni el access token.
 */
export interface PaymentsLogger {
  /**
   * @param message - Aviso en español.
   */
  warn(message: string): void
}

/** Logger que no hace nada (el valor por defecto de los casos de uso). */
export const SILENT_PAYMENTS_LOGGER: PaymentsLogger = {
  warn: () => undefined,
}
