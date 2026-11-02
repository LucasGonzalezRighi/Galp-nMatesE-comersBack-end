/** Lo mínimo que se necesita de un logger para avisar (el `Logger` de Nest lo cumple). */
export interface WarnLogger {
  /** Registra un aviso. */
  warn(message: string): void
}

/** Intervalo por defecto entre avisos: un minuto. */
export const WARN_INTERVAL_MS = 60_000

/**
 * Crea una función que avisa por `logger.warn` como mucho una vez cada `intervalMs`: con Redis
 * caído, cada pedido falla igual y no queremos un aviso por pedido.
 *
 * @param logger - Destino de los avisos.
 * @param now - Reloj en milisegundos (inyectable para los tests).
 * @param intervalMs - Mínimo entre dos avisos, en milisegundos (entero positivo).
 * @returns La función que avisa; los avisos que caen dentro del intervalo se descartan.
 */
export function createRateLimitedWarn(
  logger: WarnLogger,
  now: () => number = Date.now,
  intervalMs: number = WARN_INTERVAL_MS,
): (message: string) => void {
  if (!Number.isInteger(intervalMs) || intervalMs <= 0) {
    throw new Error(
      `El intervalo entre avisos tiene que ser un entero positivo (llegó ${String(intervalMs)})`,
    )
  }
  let lastWarnAt: number | undefined
  return (message) => {
    const current = now()
    if (lastWarnAt !== undefined && current - lastWarnAt < intervalMs) return
    lastWarnAt = current
    logger.warn(message)
  }
}

/**
 * Mensaje legible de un error desconocido (lo que llega a un `catch`).
 *
 * @param error - Lo que se atrapó.
 * @returns El `message` si es un `Error`; si no, su conversión a texto.
 */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
