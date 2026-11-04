import { formatPesos } from '../../../shared/domain/format-pesos'
import type { ProductGroup } from './category.entity'

/** Mínimo de productos de un combo. */
export const COMBO_MIN_ITEMS = 2

/** Máximo de productos de un combo: uno por grupo (mate, bombilla y yerba). */
export const COMBO_MAX_ITEMS = 3

/** Estados de un combo: borrador (la tienda no lo ve) o publicado. */
export const COMBO_STATUSES = ['draft', 'published'] as const

/** Estado de un combo. */
export type ComboStatus = (typeof COMBO_STATUSES)[number]

/**
 * Combo guardado: 2 o 3 productos de grupos distintos con un precio final, en el orden en que se
 * cargaron. Es lo que persiste el repositorio; lo que ve la tienda (`Combo` del contrato) se arma
 * con los productos vigentes.
 */
export interface ComboRecord {
  /** Id del combo (UUID). */
  id: string
  /** Nombre visible (de 3 a 80 caracteres). */
  name: string
  /** Descripción corta (hasta 300 caracteres). */
  description: string
  /** Ids de los productos, en el orden del combo (de 2 a 3). */
  productIds: string[]
  /** Precio final del combo, en pesos enteros (de 1 a 99.999.999). */
  priceArs: number
  /** Borrador o publicado. */
  status: ComboStatus
  /** Lugar en los listados, de 1 en adelante. */
  position: number
}

/** Importes de una línea de combo, en pesos enteros. */
export interface ComboLineAmounts {
  /** Bruto: `max(suma de las piezas, precio) × cantidad`. */
  grossArs: number
  /** Ahorro frente a las piezas sueltas, por la cantidad (nunca negativo). */
  savingsArs: number
  /** Lo que se cobra: `precio × cantidad` (= bruto − ahorro). */
  totalArs: number
}

/**
 * Comprueba que un monto sea de pesos enteros no negativos.
 *
 * @throws {RangeError} En español, si no lo es.
 */
function assertPesos(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(
      `${label} tiene que ser un entero de pesos mayor o igual a 0; se recibió ${String(value)}.`,
    )
  }
}

/**
 * Indica si un texto es un estado de combo.
 *
 * @param value - Texto a revisar.
 * @returns `true` si es un {@link ComboStatus}.
 */
export function isComboStatus(value: string): value is ComboStatus {
  return (COMBO_STATUSES as readonly string[]).includes(value)
}

/**
 * Calcula el ahorro de un combo frente a comprar sus piezas sueltas.
 *
 * @param listPriceArs - Suma de los precios de lista vigentes de las piezas.
 * @param priceArs - Precio final del combo.
 * @returns `max(0, lista − precio)`: si las piezas ya suman menos que el combo, no hay ahorro.
 * @throws {RangeError} En español, si algún monto no es un entero de pesos no negativo.
 * @example
 * comboSavings(68998, 61999) // 6999
 */
export function comboSavings(listPriceArs: number, priceArs: number): number {
  assertPesos(listPriceArs, 'La suma de las piezas')
  assertPesos(priceArs, 'El precio del combo')
  return Math.max(0, listPriceArs - priceArs)
}

/**
 * Calcula los importes de una línea de combo.
 *
 * El precio de lista por combo es el mayor entre la suma de las piezas y el precio del combo, así
 * el ahorro nunca es negativo: si las piezas bajan de precio y suman menos que el combo, se cobra
 * el combo sin ahorro. Siempre se cobra `precio × cantidad` y `total = bruto − ahorro`.
 *
 * @param piecePrices - Precios de lista vigentes de las piezas, de 2 a 3.
 * @param priceArs - Precio final del combo, mayor a 0.
 * @param quantity - Cantidad de combos, un entero mayor o igual a 1.
 * @returns Bruto (`max(suma, precio) × cantidad`), ahorro y total (`precio × cantidad`).
 * @throws {RangeError} En español, si no hay de 2 a 3 piezas, si un precio no es un entero de
 *   pesos, si el precio del combo es 0 o si la cantidad no es un entero mayor o igual a 1.
 * @example
 * comboLineAmounts([39999, 28999], 61999, 2)
 * // { grossArs: 137996, savingsArs: 13998, totalArs: 123998 }
 */
export function comboLineAmounts(
  piecePrices: readonly number[],
  priceArs: number,
  quantity: number,
): ComboLineAmounts {
  if (piecePrices.length < COMBO_MIN_ITEMS || piecePrices.length > COMBO_MAX_ITEMS) {
    throw new RangeError(
      `Un combo lleva de ${String(COMBO_MIN_ITEMS)} a ${String(COMBO_MAX_ITEMS)} productos; se recibieron ${String(piecePrices.length)}.`,
    )
  }
  for (const price of piecePrices) assertPesos(price, 'El precio de una pieza')
  assertPesos(priceArs, 'El precio del combo')
  if (priceArs === 0) {
    throw new RangeError('El precio del combo tiene que ser mayor a 0; se recibió 0.')
  }
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new RangeError('La cantidad tiene que ser un entero mayor o igual a 1')
  }
  const listPriceArs = piecePrices.reduce((total, price) => total + price, 0)
  const unitPriceArs = Math.max(listPriceArs, priceArs)
  return {
    grossArs: unitPriceArs * quantity,
    savingsArs: comboSavings(listPriceArs, priceArs) * quantity,
    totalArs: priceArs * quantity,
  }
}

/**
 * Indica si los productos de un combo son de grupos distintos (a lo sumo un mate, una bombilla y
 * una yerba), que es la regla para guardarlo: así cada combo tiene a lo sumo un cuero.
 *
 * @param groups - Grupo de cada producto del combo.
 * @returns `true` si ningún grupo se repite.
 * @example
 * hasDistinctGroups(['mate', 'bombilla']) // true
 * hasDistinctGroups(['yerba', 'yerba']) // false
 */
export function hasDistinctGroups(groups: readonly ProductGroup[]): boolean {
  return new Set(groups).size === groups.length
}

/**
 * Indica si el combo lleva un mate. El cliente elige cuero solo si ese mate ofrece cueros.
 *
 * @param groups - Grupo de cada producto del combo.
 * @returns `true` si alguna pieza es un mate.
 */
export function comboHasMate(groups: readonly ProductGroup[]): boolean {
  return groups.includes('mate')
}

/**
 * Mensaje del 422 `price_not_below_sum` del dashboard: el precio del combo tiene que ser menor
 * que la suma de sus productos.
 *
 * @param sumArs - Suma de los precios vigentes de las piezas, en pesos enteros.
 * @returns El mensaje con la suma en el formato de la tienda.
 * @throws {RangeError} En español, si la suma no es un entero de pesos no negativo.
 * @example
 * comboPriceNotBelowSumMessage(68998)
 * // 'El precio del combo tiene que ser menor que la suma de los productos ($68.998)'
 */
export function comboPriceNotBelowSumMessage(sumArs: number): string {
  return `El precio del combo tiene que ser menor que la suma de los productos (${formatPesos(sumArs)})`
}
