import type { Leather } from '../../catalog/domain/product.entity'

export type { Leather } from '../../catalog/domain/product.entity'

/** Cuero elegido de un mate que ofrece cueros (`CartItemOptions` del contrato). No cambia el precio. */
export interface CartItemOptions {
  /** Color del cuero, uno de los `leathers` del mate. */
  leather: Leather
}

/** Producto suelto en el carrito (`ProductCartItemInput`). */
export interface ProductCartItem {
  /** Discriminador. */
  type: 'product'
  /** Id del producto. */
  productId: string
  /** Unidades, de 1 a 20. */
  quantity: number
  /** Cuero elegido; `null` si el producto no ofrece cueros (si llega, se ignora). */
  options: CartItemOptions | null
  /** Precio de lista por unidad que la tienda tenía cotizado; si difiere, `price_changed`. */
  expectedUnitPriceArs?: number
}

/** Kit de mate, bombilla y yerba (`KitCartItemInput`), con el cuero del mate si ofrece. */
export interface KitCartItem {
  /** Discriminador. */
  type: 'kit'
  /** Id del mate. */
  mateId: string
  /** Id de la bombilla. */
  bombillaId: string
  /** Id de la yerba. */
  yerbaId: string
  /** Cuero del mate, o `null` si el mate no ofrece cueros (si llega, se ignora). */
  leather: Leather | null
  /** Cantidad de kits, de 1 a 20. */
  quantity: number
  /** Suma de las tres piezas que la tienda tenía cotizada (sin el descuento del kit). */
  expectedUnitPriceArs?: number
}

/**
 * Combo en el carrito (`ComboCartItemInput`): solo lleva el combo; la cotización usa sus piezas y
 * su precio vigentes.
 */
export interface ComboCartItem {
  /** Discriminador. */
  type: 'combo'
  /** Id del combo. */
  comboId: string
  /** Cantidad de combos, de 1 a 20. */
  quantity: number
  /** Cuero del mate del combo; `null` si no lleva mate o el mate no ofrece cueros (se ignora). */
  options: CartItemOptions | null
  /** Precio final del combo que la tienda tenía cotizado; si difiere, `price_changed`. */
  expectedUnitPriceArs?: number
}

/** Línea del carrito que manda la tienda. */
export type CartItem = ProductCartItem | KitCartItem | ComboCartItem

/** Máximo de líneas por carrito (`CartQuoteInput.items.maxItems`). */
export const MAX_CART_LINES = 50

/** Nombre de una línea de kit. */
export const KIT_LINE_NAME = 'Kit'

/**
 * Clave de la línea, igual a la que arma la tienda (`cartLineKey` y `comboLineKey` del front):
 * `product:{id}:{cuero|-}`, `kit:{mateId}:{bombillaId}:{yerbaId}:{cuero|-}` o
 * `combo:{comboId}:{cuero|-}`, con `-` si la línea no trae cuero y los acentos tal cual. Siempre
 * repite lo que mandó la tienda, ofrezca o no cueros el producto: si no, la línea de la tienda
 * queda cargando. La de un combo no incluye las piezas.
 *
 * @param item - Línea del carrito.
 * @returns La clave.
 * @example
 * cartLineKey({ type: 'combo', comboId: 'cmb-duo-imperial', quantity: 1, options: { leather: 'Marrón' } })
 * // "combo:cmb-duo-imperial:Marrón"
 */
export function cartLineKey(item: CartItem): string {
  if (item.type === 'kit') {
    return `kit:${item.mateId}:${item.bombillaId}:${item.yerbaId}:${item.leather ?? '-'}`
  }
  const prefix = item.type === 'combo' ? `combo:${item.comboId}` : `product:${item.productId}`
  return `${prefix}:${item.options?.leather ?? '-'}`
}

/**
 * Ids de los combos del carrito, sin repetir.
 *
 * @param items - Líneas del carrito.
 * @returns Los ids a buscar en el catálogo, en el orden en que aparecen.
 */
export function cartComboIds(items: readonly CartItem[]): string[] {
  return [...new Set(items.flatMap((item) => (item.type === 'combo' ? [item.comboId] : [])))]
}

/**
 * Ids de los productos de las líneas, de las piezas de los kits y de las piezas de los combos ya
 * cargados, sin repetir.
 *
 * @param items - Líneas del carrito.
 * @param combos - Ids de las piezas de cada combo encontrado, por id del combo (los que no están
 *   no aportan piezas).
 * @returns Los ids a buscar en el catálogo, en el orden en que aparecen.
 */
export function cartProductIds(
  items: readonly CartItem[],
  combos: ReadonlyMap<string, { readonly productIds: readonly string[] }> = new Map(),
): string[] {
  const ids = items.flatMap((item): readonly string[] => {
    if (item.type === 'kit') return [item.mateId, item.bombillaId, item.yerbaId]
    if (item.type === 'combo') return combos.get(item.comboId)?.productIds ?? []
    return [item.productId]
  })
  return [...new Set(ids)]
}

/**
 * Color (cuero) escrito como en el carrito de la tienda.
 *
 * @param leather - Color del cuero.
 * @returns `Color ` y el color en minúsculas (por ejemplo `Color negro`).
 */
export function leatherLabel(leather: Leather): string {
  return `Color ${leather.toLowerCase()}`
}
