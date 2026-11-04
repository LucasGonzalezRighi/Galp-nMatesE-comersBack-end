/**
 * Dónde queda la intención de mandar el mail de un mensaje nuevo mientras no hay proveedor (los
 * mails llegan en B7). En infraestructura es un `Logger` de Nest; nunca recibe datos personales
 * (ni el nombre, ni el email, ni el texto).
 */
export interface SupportMailLog {
  /**
   * @param message - Aviso en español, sin datos personales.
   */
  log(message: string): void
}

/** Registro que no hace nada (el valor por defecto de los casos de uso). */
export const SILENT_SUPPORT_MAIL_LOG: SupportMailLog = {
  log: () => undefined,
}
