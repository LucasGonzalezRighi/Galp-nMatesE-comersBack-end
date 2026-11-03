/** Formato del número de pedido: `GLP-` y cinco dígitos (`OrderNumber` del contrato). */
export const ORDER_NUMBER_PATTERN = /^GLP-[0-9]{5}$/

/** Primer valor de la secuencia `order_number_seq`: el primer pedido real es `GLP-10001`. */
export const ORDER_NUMBER_SEQUENCE_START = 10_001

/** Último valor que entra en cinco dígitos. */
export const ORDER_NUMBER_SEQUENCE_MAX = 99_999

/** Número del pedido inventado que recibe un bot que llenó el honeypot (nunca se guarda). */
export const HONEYPOT_ORDER_NUMBER = 'GLP-00000'

/**
 * Arma el número de pedido a partir de un valor de la secuencia.
 *
 * @param sequence - Valor de la secuencia: entero entre 0 y 99.999.
 * @returns `GLP-` y el valor con cinco dígitos (por ejemplo `GLP-10001`).
 * @throws {RangeError} `No quedan números de pedido.` si pasa de 99.999; otro mensaje en español
 *   si no es un entero no negativo.
 */
export function formatOrderNumber(sequence: number): string {
  if (!Number.isSafeInteger(sequence) || sequence < 0) {
    throw new RangeError(
      `El valor de la secuencia de pedidos tiene que ser un entero no negativo (llegó ${String(sequence)})`,
    )
  }
  if (sequence > ORDER_NUMBER_SEQUENCE_MAX) {
    throw new RangeError('No quedan números de pedido.')
  }
  return `GLP-${String(sequence).padStart(5, '0')}`
}

/**
 * Indica si un valor es un número de pedido. Compara exacto: no recorta ni cambia mayúsculas.
 *
 * @param value - Lo que se quiere comprobar.
 * @returns `true` si es un string que cumple {@link ORDER_NUMBER_PATTERN}.
 */
export function isOrderNumber(value: unknown): value is string {
  return typeof value === 'string' && ORDER_NUMBER_PATTERN.test(value)
}
