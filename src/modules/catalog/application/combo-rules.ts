import type { FieldError } from '../../../shared/domain/change-notice'
import {
  COMBO_MAX_ITEMS,
  COMBO_MIN_ITEMS,
  comboPriceNotBelowSumMessage,
  hasDistinctGroups,
  isComboStatus,
} from '../domain/combo.entity'
import type { Product } from '../domain/product.entity'
import type { ComboFields } from './ports/combo.repository.port'

/** Textos de los 422 del dashboard que necesitan la base (los de `MESSAGES` del front). */
export const COMBO_MESSAGES = {
  /** Producto que no existe, no está publicado o es "a consultar" (`productIds.N`). */
  productUnavailable: 'Elegí un producto publicado y con precio',
  /** Dos productos del mismo grupo (`productIds`). */
  distinctGroups: 'Elegí productos de grupos distintos',
  /** Orden que no trae todos los combos una vez cada uno (`ids`). */
  incompleteOrder: 'El orden tiene que tener todos los combos, una vez cada uno.',
} as const

/** Tope de un precio en pesos (`Pesos` del contrato). */
const MAX_PESOS = 99_999_999

/**
 * Revisa que los datos del combo tengan la forma que ya validó el DTO: los casos de uso no
 * dependen de que los llame un controlador.
 *
 * @throws {TypeError} En español, si falta el nombre, si la cantidad de productos no es de 2 a 3
 *   o si el estado no existe.
 * @throws {RangeError} En español, si el precio no es un entero de 1 a 99.999.999.
 */
export function assertComboFields(fields: ComboFields): void {
  if (fields.name.trim() === '') throw new TypeError('Un combo necesita un nombre.')
  const count = fields.productIds.length
  if (count < COMBO_MIN_ITEMS || count > COMBO_MAX_ITEMS) {
    throw new TypeError(
      `Un combo lleva de ${String(COMBO_MIN_ITEMS)} a ${String(COMBO_MAX_ITEMS)} productos; llegaron ${String(count)}.`,
    )
  }
  if (!Number.isInteger(fields.priceArs) || fields.priceArs < 1 || fields.priceArs > MAX_PESOS) {
    throw new RangeError(
      `El precio del combo tiene que ser un entero de 1 a ${String(MAX_PESOS)}; se recibió ${String(fields.priceArs)}.`,
    )
  }
  if (!isComboStatus(fields.status)) {
    throw new TypeError(`El estado "${String(fields.status)}" del combo no existe.`)
  }
}

/**
 * Valida un combo con la base (reglas 2 y 3 del mock): primero, cada producto que no existe, no
 * está publicado o es "a consultar" da un error en `productIds.<índice>`; solo si todos sirven,
 * dos productos del mismo grupo dan `productIds` `duplicate_group` y, además, un precio que no
 * queda por debajo de la suma de sus precios de lista da `priceArs` `price_not_below_sum`. Vale
 * también para los borradores.
 *
 * @param fields - Datos del combo.
 * @param products - Los productos que existen de `fields.productIds`, en cualquier estado.
 * @returns Los errores por campo, en ese orden; vacío si el combo se puede guardar.
 */
export function comboFieldErrors(fields: ComboFields, products: readonly Product[]): FieldError[] {
  const errors: FieldError[] = []
  const pieces = fields.productIds.flatMap((id, index) => {
    const product = products.find((candidate) => candidate.id === id)
    const props = product?.toProps()
    if (product === undefined || props?.status !== 'published' || props.priceArs === null) {
      errors.push({
        field: `productIds.${String(index)}`,
        code: 'product_unavailable',
        message: COMBO_MESSAGES.productUnavailable,
      })
      return []
    }
    return [{ group: product.group, priceArs: props.priceArs }]
  })
  if (errors.length > 0) return errors

  if (!hasDistinctGroups(pieces.map((piece) => piece.group))) {
    errors.push({
      field: 'productIds',
      code: 'duplicate_group',
      message: COMBO_MESSAGES.distinctGroups,
    })
  }
  const sumArs = pieces.reduce((total, piece) => total + piece.priceArs, 0)
  if (fields.priceArs >= sumArs) {
    errors.push({
      field: 'priceArs',
      code: 'price_not_below_sum',
      message: comboPriceNotBelowSumMessage(sumArs),
    })
  }
  return errors
}

/**
 * Valida un orden nuevo (regla 7 del mock): tiene que traer todos los combos, una vez cada uno.
 *
 * @param ids - Ids del orden nuevo.
 * @param currentIds - Ids de todos los combos guardados.
 * @returns `[]` si sirve; si no, el error de `ids` con `invalid_value`.
 */
export function comboOrderErrors(
  ids: readonly string[],
  currentIds: readonly string[],
): FieldError[] {
  const current = new Set(currentIds)
  const complete =
    ids.length === current.size &&
    new Set(ids).size === ids.length &&
    ids.every((id) => current.has(id))
  return complete
    ? []
    : [{ field: 'ids', code: 'invalid_value', message: COMBO_MESSAGES.incompleteOrder }]
}
