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

/** Línea del carrito que manda la tienda. */
export type CartItem = ProductCartItem | KitCartItem

/** Máximo de líneas por carrito (`CartQuoteInput.items.maxItems`). */
export const MAX_CART_LINES = 50

/** Virola fija de los mates de un kit. */
export const KIT_FERRULE: Ferrule = 'Alpaca cincelada'

/** Nombre de una línea de kit. */
export const KIT_LINE_NAME = 'Kit'

/**
 * Clave de la línea, igual a la que arma la tienda: `product:{id}:{cuero|-}:{virola|-}` o
 * `kit:{mateId}:{bombillaId}:{yerbaId}:{cuero}`, con acentos y espacios tal cual.
 *
 * @param item - Línea del carrito.
 * @param isMate - Si el producto suelto es un mate: en los demás las opciones se ignoran.
 * @returns La clave.
 */
export function cartLineKey(item: CartItem, isMate: boolean): string {
  if (item.type === 'kit') {
    return `kit:${item.mateId}:${item.bombillaId}:${item.yerbaId}:${item.leather}`
  }
  const options = isMate ? item.options : null
  return `product:${item.productId}:${options?.leather ?? '-'}:${options?.ferrule ?? '-'}`
}

/**
 * Ids de los productos de las líneas y de las piezas de los kits, sin repetir.
 *
 * @param items - Líneas del carrito.
 * @returns Los ids a buscar en el catálogo, en el orden en que aparecen.
 */
export function cartProductIds(items: readonly CartItem[]): string[] {
  const ids = items.flatMap((item) =>
    item.type === 'kit' ? [item.mateId, item.bombillaId, item.yerbaId] : [item.productId],
  )
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
