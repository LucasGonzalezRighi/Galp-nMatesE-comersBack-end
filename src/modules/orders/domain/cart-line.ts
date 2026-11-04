import type { FERRULES, LEATHERS } from '../../catalog/domain/product.entity'

/** Color de cuero de un mate (`Leather` del contrato). */
export type Leather = (typeof LEATHERS)[number]

/** Virola de un mate (`Ferrule` del contrato). */
export type Ferrule = (typeof FERRULES)[number]

/** Cuero y virola elegidos para un mate (`CartItemOptions` del contrato). No cambian el precio. */
export interface CartItemOptions {
  /** Color del cuero. */
  leather: Leather
  /** Virola. */
  ferrule: Ferrule
}

/** Producto suelto en el carrito (`ProductCartItemInput`). */
export interface ProductCartItem {
  /** Discriminador. */
  type: 'product'
  /** Id del producto. */
  productId: string
  /** Unidades, de 1 a 20. */
  quantity: number
  /** Cuero y virola; `null` en los productos que no son mates (si llegan, se ignoran). */
  options: CartItemOptions | null
  /** Precio de lista por unidad que la tienda tenía cotizado; si difiere, `price_changed`. */
  expectedUnitPriceArs?: number
}

/** Kit de mate, bombilla y yerba (`KitCartItemInput`): la virola es fija ({@link KIT_FERRULE}). */
export interface KitCartItem {
  /** Discriminador. */
  type: 'kit'
  /** Id del mate. */
  mateId: string
  /** Id de la bombilla. */
  bombillaId: string
  /** Id de la yerba. */
  yerbaId: string
  /** Cuero del mate. */
  leather: Leather
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
  /** Cuero y virola del mate del combo; `null` si no lleva mate (si llegan, se ignoran). */
  options: CartItemOptions | null
  /** Precio final del combo que la tienda tenía cotizado; si difiere, `price_changed`. */
  expectedUnitPriceArs?: number
}

/** Línea del carrito que manda la tienda. */
export type CartItem = ProductCartItem | KitCartItem | ComboCartItem

/** Máximo de líneas por carrito (`CartQuoteInput.items.maxItems`). */
export const MAX_CART_LINES = 50

/** Virola fija de los mates de un kit. */
export const KIT_FERRULE: Ferrule = 'Alpaca cincelada'

/** Nombre de una línea de kit. */
export const KIT_LINE_NAME = 'Kit'

/**
 * Clave de la línea, igual a la que arma la tienda: `product:{id}:{cuero|-}:{virola|-}`,
 * `kit:{mateId}:{bombillaId}:{yerbaId}:{cuero}` o `combo:{comboId}:{cuero|-}:{virola|-}`, con
 * acentos y espacios tal cual. La de un combo no incluye las piezas.
 *
 * @param item - Línea del carrito.
 * @param isMate - Si el producto suelto es un mate, o si el combo lleva mate o no existe (sin el
 *   combo no se sabe y se conserva lo que mandó la tienda): en los demás las opciones se ignoran.
 * @returns La clave.
 */
export function cartLineKey(item: CartItem, isMate: boolean): string {
  if (item.type === 'kit') {
    return `kit:${item.mateId}:${item.bombillaId}:${item.yerbaId}:${item.leather}`
  }
  const options = isMate ? item.options : null
  const prefix = item.type === 'combo' ? `combo:${item.comboId}` : `product:${item.productId}`
  return `${prefix}:${options?.leather ?? '-'}:${options?.ferrule ?? '-'}`
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
 * Cuero escrito como en el carrito de la tienda.
 *
 * @param leather - Color del cuero.
 * @returns `Cuero ` y el color en minúsculas (por ejemplo `Cuero negro`).
 */
export function leatherLabel(leather: Leather): string {
  return `Cuero ${leather.toLowerCase()}`
}
