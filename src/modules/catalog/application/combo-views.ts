import { comboSavings, hasDistinctGroups } from '../domain/combo.entity'
import type { Product } from '../domain/product.entity'
import type { StoredCombo } from './ports/combo.repository.port'
import type { PriceDisplay } from './ports/price-display.port'
import type { ComboItemView, ComboView } from './read-models'

/**
 * Piezas de un combo en el orden de sus `productIds`; una que ya no está no aparece.
 *
 * @param stored - Combo guardado con sus productos.
 * @returns Los productos del combo, en orden.
 */
function piecesInOrder(stored: StoredCombo): Product[] {
  return stored.combo.productIds.flatMap((id) => stored.pieces.filter((piece) => piece.id === id))
}

/**
 * Indica si todas las piezas del combo están y son de grupos distintos: un producto movido de
 * línea puede dejar dos piezas del mismo grupo, y entonces el combo no se vende (Ruling B-65).
 */
function hasAllDistinctPieces(stored: StoredCombo, pieces: readonly Product[]): boolean {
  return (
    pieces.length === stored.combo.productIds.length &&
    hasDistinctGroups(pieces.map((piece) => piece.group))
  )
}

/**
 * Precio sin impuestos nacionales, con la fórmula del front (`netPrice`).
 *
 * @throws {RangeError} En español, si la alícuota está fuera de 0 a 100.
 */
function netPriceOf(priceArs: number, vatRatePercent: number): number {
  if (!Number.isFinite(vatRatePercent) || vatRatePercent < 0 || vatRatePercent > 100) {
    throw new RangeError(
      `La alícuota tiene que ser un número entre 0 y 100; se recibió ${String(vatRatePercent)}.`,
    )
  }
  return Math.round(priceArs / (1 + vatRatePercent / 100))
}

/**
 * Arma una pieza de un combo con los datos vigentes del producto (`toComboItem` del mock).
 *
 * @param product - Producto en cualquier estado.
 * @returns La pieza: precio de lista, si se vende y cuántas unidades quedan sin reservar.
 */
export function toComboItemView(product: Product): ComboItemView {
  const props = product.toProps()
  return {
    productId: props.id,
    slug: props.slug,
    name: props.name,
    group: product.group,
    unitPriceArs: props.priceArs,
    isPurchasable: product.isPurchasable(),
    maxQuantity: product.maxQuantity(),
    image: product.mainImage(),
  }
}

/**
 * Arma el combo como lo devuelve la API (`toCombo` del mock): la suma de los precios de lista de
 * las piezas con precio, el ahorro (nunca negativo), si se puede comprar (publicado y con todas sus
 * piezas a la venta y de grupos distintos), si alguna pieza se agotó y cuántos combos se pueden
 * pedir.
 *
 * @param stored - Combo guardado con sus productos vigentes.
 * @param prices - Si se muestra el precio sin IVA y con qué alícuota.
 * @returns El combo con la forma `Combo` del contrato.
 * @throws {RangeError} En español, si un precio no es un entero de pesos o la alícuota está fuera
 *   de rango.
 */
export function toComboView(stored: StoredCombo, prices: PriceDisplay): ComboView {
  const { combo } = stored
  const pieces = piecesInOrder(stored)
  const items = pieces.map(toComboItemView)
  const listPriceArs = items.reduce((total, item) => total + (item.unitPriceArs ?? 0), 0)
  const isPurchasable =
    combo.status === 'published' &&
    hasAllDistinctPieces(stored, pieces) &&
    items.every((item) => item.isPurchasable)
  return {
    id: combo.id,
    name: combo.name,
    description: combo.description,
    items,
    priceArs: combo.priceArs,
    netPriceArs: prices.showNetPrice ? netPriceOf(combo.priceArs, prices.vatRatePercent) : null,
    listPriceArs,
    savingsArs: comboSavings(listPriceArs, combo.priceArs),
    isPurchasable,
    isSoldOut: items.some((item) => item.maxQuantity === 0),
    maxQuantity: isPurchasable ? Math.min(...items.map((item) => item.maxQuantity)) : 0,
    status: combo.status,
    position: combo.position,
  }
}

/**
 * Indica si un combo está a la venta en la tienda (`isComboForSale` del mock): publicado y con
 * todas sus piezas publicadas, con precio y de grupos distintos. El stock no cuenta: un combo con
 * una pieza agotada se muestra "Sin stock".
 *
 * @param stored - Combo guardado con sus productos vigentes.
 * @returns `true` si `GET /combos` lo muestra.
 */
export function isComboForSale(stored: StoredCombo): boolean {
  const pieces = piecesInOrder(stored)
  return (
    stored.combo.status === 'published' &&
    hasAllDistinctPieces(stored, pieces) &&
    pieces.every((piece) => {
      const { status, priceArs } = piece.toProps()
      return status === 'published' && priceArs !== null
    })
  )
}
