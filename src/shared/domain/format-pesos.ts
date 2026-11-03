/** Formato de la tienda: separador de miles con punto y sin decimales. */
const PESOS_FORMAT = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 })

/**
 * Escribe un monto en pesos como lo muestra la tienda, para los mensajes de los avisos.
 *
 * @param amount - Pesos enteros, no negativos.
 * @returns `$` y el monto con separador de miles (por ejemplo `$46.499`).
 * @throws {RangeError} En español, si el monto no es un entero no negativo.
 */
export function formatPesos(amount: number): string {
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new RangeError(
      `Un monto en pesos tiene que ser un entero no negativo (llegó ${String(amount)})`,
    )
  }
  return `$${PESOS_FORMAT.format(amount)}`
}
