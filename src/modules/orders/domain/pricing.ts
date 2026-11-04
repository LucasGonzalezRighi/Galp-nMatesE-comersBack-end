import type { ChangeNotice, FieldError } from '../../../shared/domain/change-notice'
import { formatPesos } from '../../../shared/domain/format-pesos'
import { Pesos } from '../../../shared/domain/pesos'
import type { ProductGroup } from '../../catalog/domain/category.entity'
import {
  COMBO_MAX_ITEMS,
  COMBO_MIN_ITEMS,
  type ComboLineAmounts,
  comboLineAmounts,
  type ComboStatus,
  hasDistinctGroups,
} from '../../catalog/domain/combo.entity'
import { MAX_QUANTITY_PER_PRODUCT } from '../../catalog/domain/inventory.entity'
import {
  type CartItem,
  type CartItemOptions,
  cartLineKey,
  type ComboCartItem,
  KIT_LINE_NAME,
  type Leather,
  leatherLabel,
  MAX_CART_LINES,
} from './cart-line'
import type { LineType } from './order-status'
import { CartTotalTooBigError } from './orders-errors'

/** Tope de los montos que suman o multiplican otros (`TotalArs`: el máximo de un entero de 32 bits). */
export const MAX_TOTAL_ARS = 2_147_483_647

/** Nombre de una línea cuyo producto no existe. */
export const MISSING_PRODUCT_NAME = 'Producto no disponible'

/** Nombre de una línea cuyo combo no existe. */
export const MISSING_COMBO_NAME = 'Combo no disponible'

/** Mensaje de un mate que ofrece cueros (suelto, en un kit o en un combo) y llega sin cuero. */
export const MISSING_LEATHER_MESSAGE = 'Elegí el cuero del mate.'

/** Mensaje de un mate que llega con un cuero que no ofrece. */
export const LEATHER_NOT_OFFERED_MESSAGE = 'Ese cuero no está disponible para este mate.'

/** Producto como lo necesita la cotización. */
export interface PricedProduct {
  /** Id del producto. */
  id: string
  /** Slug actual. */
  slug: string
  /** Nombre. */
  name: string
  /** Grupo de su línea (mate, bombilla o yerba). */
  group: ProductGroup
  /** Cueros que ofrece (vacío si no tiene selector de cuero, siempre fuera de los mates). */
  leathers: readonly Leather[]
  /** Precio de lista, o `null` si es "a consultar" (no se vende). */
  priceArs: number | null
  /** Si está publicado. */
  published: boolean
  /** Stock libre: `on_hand − reserved`. */
  available: number
}

/** Combo como lo necesita la cotización: sus piezas se buscan aparte, como {@link PricedProduct}. */
export interface PricedCombo {
  /** Id del combo. */
  id: string
  /** Nombre (el de la línea). */
  name: string
  /** Borrador o publicado: solo se vende publicado. */
  status: ComboStatus
  /** Precio final del combo, en pesos enteros. */
  priceArs: number
  /** Ids de las piezas, en el orden del combo. */
  productIds: string[]
}

/** Ajustes de la tienda que cambian los importes. */
export interface PricingSettings {
  /** Descuento del kit, entero de 0 a 30. */
  kitDiscountPercent: number
  /** Alícuota de IVA en porcentaje (puede tener decimales). */
  vatRatePercent: number
  /** Si se informan los precios sin impuestos nacionales; si no, los netos son `null`. */
  showNetPrice: boolean
}

/** Problemas de una línea cotizada (`CartQuoteLine.issue`). */
export type LineIssue = 'unavailable' | 'sold_out' | 'quantity_reduced' | 'price_changed'

/** Línea cotizada (`CartQuoteLine` del contrato). */
export interface CartQuoteLine {
  /** Clave igual a la de la tienda. */
  key: string
  /** Producto suelto, kit o combo. */
  type: LineType
  /** Nombre del producto, `Kit`, el del combo, `Producto no disponible` o `Combo no disponible`. */
  name: string
  /** Opciones elegidas (en un kit o un combo, además las piezas con " + "); vacío si no hay. */
  detail: string
  /**
   * Precio de lista de una unidad (en un kit, la suma de las tres piezas; en un combo,
   * `max(suma de las piezas, precio del combo)`).
   */
  unitPriceArs: number
  /** Neto de lo que paga el cliente por unidad, o `null` con `showNetPrice` apagado. */
  netUnitPriceArs: number | null
  /** Ahorro por kit o por combo de toda la línea. */
  kitSavingsArs: number
  /** `unitPriceArs × cantidad − kitSavingsArs`. */
  totalArs: number
  /** Lo máximo que se puede pedir de esta línea (0 si no hay). */
  maxQuantity: number
  /** Problema de la línea, o `null`. */
  issue: LineIssue | null
}

/** Cotización del carrito (`CartQuote` del contrato), sin el envío. */
export interface CartQuote {
  /** Líneas en el orden del carrito. */
  lines: CartQuoteLine[]
  /** Suma de los precios de lista de las líneas compradas. */
  itemsGrossArs: number
  /** Suma de los ahorros por kit y por combo. */
  kitSavingsArs: number
  /** `itemsGrossArs − kitSavingsArs`. */
  subtotalArs: number
  /** Neto del subtotal, o `null` con `showNetPrice` apagado. */
  netSubtotalArs: number | null
}

/** Pieza de un kit o de un combo tal como se compró. */
export interface OrderKitItemDraft {
  /** Grupo de la pieza (en un kit, su rol; en un combo no se repite). */
  role: ProductGroup
  /**
   * Lugar de la pieza en la línea, desde 1 (en un combo, el orden del combo; en un kit, mate,
   * bombilla y yerba). Los kits guardados antes de los combos pueden tener 0.
   */
  position: number
  /** Id del producto. */
  productId: string
  /** Slug al comprar. */
  slug: string
  /** Nombre al comprar. */
  name: string
  /** Precio de lista de la pieza al comprar. */
  unitPriceArs: number
}

/** Línea que va al pedido: copia de lo que se compró (nombres, slugs y precios del momento). */
export interface OrderLineDraft {
  /** Producto suelto, kit o combo. */
  type: LineType
  /** Nombre del producto, `Kit` o el del combo. */
  name: string
  /** Cuero elegido (en un kit o un combo, además las piezas); vacío si no hay. */
  detail: string
  /** Unidades compradas (ya reducidas al stock). */
  quantity: number
  /** Precio de lista de una unidad. */
  unitPriceArs: number
  /** Ahorro por kit o por combo de la línea. */
  kitSavingsArs: number
  /** Importe de la línea. */
  totalArs: number
  /** Id del producto suelto; `null` en un kit o un combo. */
  productId: string | null
  /** Slug del producto suelto; `null` en un kit o un combo. */
  productSlug: string | null
  /** Cuero de un mate, del mate del kit o del mate del combo; `null` si la línea no tiene cuero. */
  options: CartItemOptions | null
  /** Las piezas de un kit (3) o de un combo (2 o 3, en su orden); `null` en un producto suelto. */
  kitItems: OrderKitItemDraft[] | null
}

/** Unidades que reserva un pedido de un producto. */
export interface ReservationLine {
  /** Id del producto. */
  productId: string
  /** Unidades (sueltas y piezas de kits sumadas). */
  quantity: number
}

/** Resultado de {@link priceCart}. */
export interface PricedCart {
  /** La cotización como la devuelve `POST /cart/quote`. */
  quote: CartQuote
  /** Líneas que se pueden comprar, para el pedido. */
  lines: OrderLineDraft[]
  /** Unidades a reservar por producto, en el orden en que aparecen. */
  reservation: ReservationLine[]
  /** Avisos de las líneas `unavailable`, `sold_out` y `quantity_reduced`. */
  stockChanges: ChangeNotice[]
  /** Avisos de las líneas `price_changed`. */
  priceChanges: ChangeNotice[]
  /**
   * Cueros que faltan o que el mate no ofrece (`items.{i}.options`, `items.{i}.options.leather` o,
   * en un kit, `items.{i}.leather`).
   */
  optionErrors: FieldError[]
}

/**
 * Precio sin impuestos nacionales (Ley 27.743).
 *
 * @param amountArs - Precio final, en pesos enteros.
 * @param vatRatePercent - Alícuota de IVA, de 0 a 100.
 * @returns `round(amountArs / (1 + vatRatePercent / 100))`.
 * @throws {RangeError} En español, si el monto no es un entero no negativo o la alícuota está
 *   fuera de rango.
 */
export function netPrice(amountArs: number, vatRatePercent: number): number {
  const amount = Pesos.of(amountArs).toNumber()
  if (!Number.isFinite(vatRatePercent) || vatRatePercent < 0 || vatRatePercent > 100) {
    throw new RangeError(
      `La alícuota de IVA tiene que estar entre 0 y 100 (llegó ${String(vatRatePercent)})`,
    )
  }
  return Math.round(amount / (1 + vatRatePercent / 100))
}

/**
 * Aviso de stock de un producto para un 409 `stock_changed`.
 *
 * @param productId - Producto afectado.
 * @param productName - Su nombre.
 * @param remaining - Unidades que se pueden pedir todavía.
 * @returns `Quedan N unidades de X.`, `Queda 1 unidad de X.` o `X se agotó.`.
 */
export function stockChangeNotice(
  productId: string | null,
  productName: string,
  remaining: number,
): ChangeNotice {
  const units = Math.max(0, Math.floor(remaining))
  const message =
    units === 0
      ? `${productName} se agotó.`
      : units === 1
        ? `Queda 1 unidad de ${productName}.`
        : `Quedan ${String(units)} unidades de ${productName}.`
  return { kind: 'stock', productId, message }
}

/** Producto que se puede vender: publicado, con precio y, si se pide, del grupo indicado. */
function isSellable(
  product: PricedProduct | undefined,
  group: ProductGroup | undefined,
): product is PricedProduct & { priceArs: number } {
  return (
    product !== undefined &&
    product.published &&
    product.priceArs !== null &&
    (group === undefined || product.group === group)
  )
}

/** Unidades que todavía se pueden pedir de un producto: tope 20 y stock, menos lo ya aceptado. */
function roomFor(product: PricedProduct, accepted: ReadonlyMap<string, number>): number {
  const cap = Math.max(0, Math.min(MAX_QUANTITY_PER_PRODUCT, Math.floor(product.available)))
  return Math.max(0, cap - (accepted.get(product.id) ?? 0))
}

/** Línea que no se puede comprar: todos los importes en 0. */
function blockedLine(
  base: Pick<CartQuoteLine, 'key' | 'type' | 'name' | 'detail'>,
  issue: 'unavailable' | 'sold_out',
  showNetPrice: boolean,
): CartQuoteLine {
  return {
    ...base,
    unitPriceArs: 0,
    netUnitPriceArs: showNetPrice ? 0 : null,
    kitSavingsArs: 0,
    totalArs: 0,
    maxQuantity: 0,
    issue,
  }
}

/** Lo que la cotización va juntando línea por línea (cada rama lo modifica). */
interface PricingState {
  /** Unidades ya tomadas por producto (sueltas y piezas de kits y combos). */
  accepted: Map<string, number>
  /** Líneas cotizadas. */
  quoteLines: CartQuoteLine[]
  /** Líneas que van al pedido. */
  lines: OrderLineDraft[]
  /** Avisos de stock y de bajas. */
  stockChanges: ChangeNotice[]
  /** Avisos de precio. */
  priceChanges: ChangeNotice[]
  /** Cueros que faltan o que el mate no ofrece. */
  optionErrors: FieldError[]
}

/**
 * Cuero que vale para una línea: el que mandó la tienda, si el mate lo ofrece.
 *
 * @param sent - Cuero que mandó la tienda, o `null`.
 * @param offered - Cueros que ofrece el mate (vacío si no es un mate o no tiene selector).
 * @returns `sent` si está en `offered`; si no, `null` (sin cueros, el que llegue se ignora).
 */
function offeredLeather(sent: Leather | null, offered: readonly Leather[]): Leather | null {
  return sent !== null && offered.includes(sent) ? sent : null
}

/**
 * Error del cuero de una línea, con las reglas de `quoteCart` del contrato y del mock.
 *
 * @param sent - Cuero que mandó la tienda, o `null`.
 * @param offered - Cueros que ofrece el mate.
 * @param fields - Campo del error si falta el cuero y si el mate no lo ofrece.
 * @returns El error (`required` o `leather_not_offered`), o `null` si el mate no ofrece cueros o
 *   el cuero es uno de los suyos.
 */
function leatherError(
  sent: Leather | null,
  offered: readonly Leather[],
  fields: { missing: string; notOffered: string },
): FieldError | null {
  if (offered.length === 0) return null
  if (sent === null) {
    return { field: fields.missing, code: 'required', message: MISSING_LEATHER_MESSAGE }
  }
  if (!offered.includes(sent)) {
    return {
      field: fields.notOffered,
      code: 'leather_not_offered',
      message: LEATHER_NOT_OFFERED_MESSAGE,
    }
  }
  return null
}

/**
 * Cotiza una línea de combo con las reglas de `ComboCartItemInput` del contrato y del mock:
 * combo inexistente o en borrador, una pieza que no se vende o piezas que ya no son de grupos
 * distintos → `unavailable` (con el nombre del combo); mate con cueros sin cuero → error en
 * `items.{i}.options`, y con uno que no ofrece → en `items.{i}.options.leather`; la clave repite
 * lo que mandó la tienda; stock de cada pieza compartido con las demás líneas; importes de
 * {@link comboLineAmounts}; `price_changed` contra el precio del combo, con `productId` `null`.
 *
 * @param item - Línea de combo.
 * @param index - Lugar de la línea en el carrito, para el error por campo.
 * @param combo - El combo de la línea, o `undefined` si no existe.
 * @param products - Productos por id (las piezas que no están cuentan como inexistentes).
 * @param settings - IVA y si se muestran los netos.
 * @param state - Lo cotizado hasta acá (se modifica).
 * @returns Los importes de la línea, o `null` si no se puede comprar.
 */
function priceComboItem(
  item: ComboCartItem,
  index: number,
  combo: PricedCombo | undefined,
  products: ReadonlyMap<string, PricedProduct>,
  settings: PricingSettings,
  state: PricingState,
): ComboLineAmounts | null {
  const { vatRatePercent, showNetPrice } = settings
  const found = (combo?.productIds ?? []).map((id) => products.get(id))
  // Los cueros del mate del combo (`comboMateLeathers` del front); vacío si no lleva mate.
  const offered = found.find((product) => product?.group === 'mate')?.leathers ?? []
  const sent = item.options?.leather ?? null
  const leather = offeredLeather(sent, offered)
  const name = combo?.name ?? MISSING_COMBO_NAME
  const pieceNames = found.map((product) => product?.name ?? MISSING_PRODUCT_NAME).join(' + ')
  const base = {
    key: cartLineKey(item),
    type: item.type,
    name,
    detail:
      leather === null || pieceNames === ''
        ? pieceNames
        : `${pieceNames} · ${leatherLabel(leather)}`,
  }
  const blocked = (issue: 'unavailable' | 'sold_out', notice: ChangeNotice): null => {
    state.quoteLines.push(blockedLine(base, issue, showNetPrice))
    state.stockChanges.push(notice)
    return null
  }
  const unavailable = (productId: string | null): null =>
    blocked('unavailable', {
      kind: 'unavailable',
      productId,
      message: `${name} ya no está disponible.`,
    })

  if (combo?.status !== 'published') return unavailable(null)
  const missing = found.findIndex((product) => !isSellable(product, undefined))
  if (missing !== -1) return unavailable(combo.productIds[missing] ?? null)
  const pieces = found.filter((product) => isSellable(product, undefined))
  if (
    pieces.length < COMBO_MIN_ITEMS ||
    pieces.length > COMBO_MAX_ITEMS ||
    !hasDistinctGroups(pieces.map((product) => product.group))
  ) {
    return unavailable(null)
  }
  const error = leatherError(sent, offered, {
    missing: `items.${String(index)}.options`,
    notOffered: `items.${String(index)}.options.leather`,
  })
  if (error !== null) state.optionErrors.push(error)

  const rooms = pieces.map((product) => roomFor(product, state.accepted))
  const room = Math.min(...rooms)
  const limitingId = pieces[rooms.indexOf(room)]?.id ?? null
  if (room === 0) return blocked('sold_out', stockChangeNotice(limitingId, name, 0))

  const quantity = Math.min(item.quantity, room)
  const amounts = comboLineAmounts(
    pieces.map((product) => product.priceArs),
    combo.priceArs,
    quantity,
  )
  const unitPriceArs = amounts.grossArs / quantity
  const priceChanged =
    item.expectedUnitPriceArs !== undefined && item.expectedUnitPriceArs !== combo.priceArs
  const issue: LineIssue | null =
    quantity < item.quantity ? 'quantity_reduced' : priceChanged ? 'price_changed' : null
  for (const product of pieces) {
    state.accepted.set(product.id, (state.accepted.get(product.id) ?? 0) + quantity)
  }
  if (issue === 'quantity_reduced') {
    state.stockChanges.push(stockChangeNotice(limitingId, name, room))
  } else if (issue === 'price_changed') {
    state.priceChanges.push({
      kind: 'price',
      productId: null,
      message: `${name} cambió de precio: ahora cuesta ${formatPesos(combo.priceArs)}.`,
    })
  }
  state.quoteLines.push({
    ...base,
    unitPriceArs,
    netUnitPriceArs: showNetPrice ? netPrice(combo.priceArs, vatRatePercent) : null,
    kitSavingsArs: amounts.savingsArs,
    totalArs: amounts.totalArs,
    maxQuantity: room,
    issue,
  })
  state.lines.push({
    type: item.type,
    name,
    detail: base.detail,
    quantity,
    unitPriceArs,
    kitSavingsArs: amounts.savingsArs,
    totalArs: amounts.totalArs,
    productId: null,
    productSlug: null,
    options: leather === null ? null : { leather },
    kitItems: pieces.map((product, position) => ({
      role: product.group,
      position: position + 1,
      productId: product.id,
      slug: product.slug,
      name: product.name,
      unitPriceArs: product.priceArs,
    })),
  })
  return amounts
}

/** Valida las líneas y los ajustes antes de cotizar. */
function assertPricingInput(items: readonly CartItem[], settings: PricingSettings): void {
  if (items.length < 1 || items.length > MAX_CART_LINES) {
    throw new RangeError(
      `El carrito tiene que tener de 1 a ${String(MAX_CART_LINES)} líneas (llegaron ${String(items.length)})`,
    )
  }
  for (const item of items) {
    if (
      !Number.isInteger(item.quantity) ||
      item.quantity < 1 ||
      item.quantity > MAX_QUANTITY_PER_PRODUCT
    ) {
      throw new RangeError(
        `La cantidad de una línea tiene que ser un entero de 1 a ${String(MAX_QUANTITY_PER_PRODUCT)} (llegó ${String(item.quantity)})`,
      )
    }
  }
  const { kitDiscountPercent } = settings
  if (!Number.isInteger(kitDiscountPercent) || kitDiscountPercent < 0 || kitDiscountPercent > 30) {
    throw new RangeError(
      `El descuento del kit tiene que ser un entero de 0 a 30 (llegó ${String(kitDiscountPercent)})`,
    )
  }
}

/**
 * Cotiza el carrito como el mock del front: línea por línea y en orden, con el tope de 20 y el
 * stock compartidos por producto entre todas las líneas (sueltas y piezas de kits y de combos).
 * Una línea con problemas no hace fallar la cotización: se informa en `issue` y en los avisos.
 *
 * - Pieza inexistente, no publicada, sin precio o de otro grupo → `unavailable` (sin error de cuero).
 * - Producto suelto o mate del kit que ofrece cueros: sin cuero → error `required`; con uno que no
 *   ofrece → `leather_not_offered`. Sin cueros ofrecidos, el cuero que llegue se ignora. La clave
 *   repite siempre lo que mandó la tienda.
 * - Combo inexistente, en borrador o con piezas que ya no son de grupos distintos → `unavailable`.
 * - Sin lugar → `sold_out`; con menos lugar que lo pedido → `quantity_reduced` (se cotiza el máximo).
 * - `expectedUnitPriceArs` distinto del vigente (en un combo, de su precio) → `price_changed`
 *   (pierde contra el stock).
 * - Ahorro del kit por unidad (`Pesos.percentOf`) por la cantidad; el de un combo, contra la suma
 *   de sus piezas ({@link comboLineAmounts}); netos redondeados.
 *
 * @param items - Líneas del carrito (de 1 a 50, cantidades de 1 a 20).
 * @param products - Productos por id, también las piezas de los combos (los que no están cuentan
 *   como inexistentes).
 * @param combos - Combos por id (los que no están cuentan como inexistentes).
 * @param settings - Descuento del kit, IVA y si se muestran los netos.
 * @returns La cotización, las líneas compradas, la reserva y los avisos.
 * @throws {CartTotalTooBigError} Si la suma de las líneas pasa de {@link MAX_TOTAL_ARS}.
 * @throws {RangeError} En español, si las líneas, las cantidades o los ajustes están fuera de rango.
 */
export function priceCart(
  items: readonly CartItem[],
  products: ReadonlyMap<string, PricedProduct>,
  combos: ReadonlyMap<string, PricedCombo>,
  settings: PricingSettings,
): PricedCart {
  assertPricingInput(items, settings)
  const { kitDiscountPercent, vatRatePercent, showNetPrice } = settings
  const state: PricingState = {
    accepted: new Map(),
    quoteLines: [],
    lines: [],
    stockChanges: [],
    priceChanges: [],
    optionErrors: [],
  }
  const { accepted, quoteLines, lines, stockChanges, priceChanges, optionErrors } = state
  let itemsGross = Pesos.of(0)
  let kitSavings = Pesos.of(0)

  items.forEach((item, index) => {
    if (item.type === 'combo') {
      const combo = combos.get(item.comboId)
      const amounts = priceComboItem(item, index, combo, products, settings, state)
      if (amounts !== null) {
        itemsGross = itemsGross.add(Pesos.of(amounts.grossArs))
        kitSavings = kitSavings.add(Pesos.of(amounts.savingsArs))
      }
      return
    }
    const pieces: readonly (readonly [string, ProductGroup | undefined])[] =
      item.type === 'kit'
        ? [
            [item.mateId, 'mate'],
            [item.bombillaId, 'bombilla'],
            [item.yerbaId, 'yerba'],
          ]
        : [[item.productId, undefined]]
    const found = pieces.map(([id]) => products.get(id))
    const sellable = pieces.map(([id, group]) => {
      const product = products.get(id)
      return isSellable(product, group) ? product : undefined
    })
    // El producto suelto o el mate del kit: sus cueros son los que se pueden elegir.
    const first = found[0]
    const offered = first?.leathers ?? []
    const sent = item.type === 'kit' ? item.leather : (item.options?.leather ?? null)
    const leather = offeredLeather(sent, offered)
    const leatherText = leather === null ? '' : leatherLabel(leather)
    const pieceNames = found.map((product) => product?.name ?? MISSING_PRODUCT_NAME).join(' + ')
    const name = item.type === 'kit' ? KIT_LINE_NAME : (first?.name ?? MISSING_PRODUCT_NAME)
    const base = {
      key: cartLineKey(item),
      type: item.type,
      name,
      detail:
        item.type !== 'kit'
          ? leatherText
          : leather === null
            ? pieceNames
            : `${pieceNames} · ${leatherText}`,
    }

    const missing = sellable.findIndex((product) => product === undefined)
    if (missing !== -1) {
      quoteLines.push(blockedLine(base, 'unavailable', showNetPrice))
      stockChanges.push({
        kind: 'unavailable',
        productId: pieces[missing]?.[0] ?? null,
        message: `${found[missing]?.name ?? name} ya no está disponible.`,
      })
      return
    }
    // Sin error de cuero en una línea que no se vende: va después de `unavailable`.
    const field =
      item.type === 'kit' ? `items.${String(index)}.leather` : `items.${String(index)}.options`
    const error = leatherError(sent, offered, {
      missing: field,
      notOffered: item.type === 'kit' ? field : `${field}.leather`,
    })
    if (error !== null) optionErrors.push(error)
    const sold = sellable.filter((product) => product !== undefined)
    const rooms = sold.map((product) => roomFor(product, accepted))
    const room = Math.min(...rooms)
    const limiting = sold[rooms.indexOf(room)]
    const limitingId = limiting?.id ?? null
    const limitingName = limiting?.name ?? name
    if (room === 0) {
      quoteLines.push(blockedLine(base, 'sold_out', showNetPrice))
      stockChanges.push(stockChangeNotice(limitingId, limitingName, 0))
      return
    }

    const quantity = Math.min(item.quantity, room)
    const unitPrice = sold.reduce(
      (sum, product) => sum.add(Pesos.of(product.priceArs)),
      Pesos.of(0),
    )
    const gross = unitPrice.multiply(quantity)
    const savings =
      item.type === 'kit' ? unitPrice.percentOf(kitDiscountPercent).multiply(quantity) : Pesos.of(0)
    const total = gross.toNumber() - savings.toNumber()
    const unitPriceArs = unitPrice.toNumber()
    const priceChanged =
      item.expectedUnitPriceArs !== undefined && item.expectedUnitPriceArs !== unitPriceArs
    const issue: LineIssue | null =
      quantity < item.quantity ? 'quantity_reduced' : priceChanged ? 'price_changed' : null
    for (const product of sold) {
      accepted.set(product.id, (accepted.get(product.id) ?? 0) + quantity)
    }
    itemsGross = itemsGross.add(gross)
    kitSavings = kitSavings.add(savings)

    if (issue === 'quantity_reduced') {
      stockChanges.push(stockChangeNotice(limitingId, limitingName, room))
    } else if (issue === 'price_changed') {
      priceChanges.push({
        kind: 'price',
        productId: limitingId,
        message: `${name} cambió de precio: ahora cuesta ${formatPesos(unitPriceArs)}.`,
      })
    }
    quoteLines.push({
      ...base,
      unitPriceArs,
      netUnitPriceArs: showNetPrice ? netPrice(total / quantity, vatRatePercent) : null,
      kitSavingsArs: savings.toNumber(),
      totalArs: total,
      maxQuantity: room,
      issue,
    })
    const single = item.type === 'product' ? sold[0] : undefined
    lines.push({
      type: item.type,
      name,
      detail: base.detail,
      quantity,
      unitPriceArs,
      kitSavingsArs: savings.toNumber(),
      totalArs: total,
      productId: single?.id ?? null,
      productSlug: single?.slug ?? null,
      options: leather === null ? null : { leather },
      kitItems:
        item.type === 'kit'
          ? sold.map((product, position) => ({
              role: pieces[position]?.[1] ?? product.group,
              position: position + 1,
              productId: product.id,
              slug: product.slug,
              name: product.name,
              unitPriceArs: product.priceArs,
            }))
          : null,
    })
  })

  if (itemsGross.toNumber() > MAX_TOTAL_ARS) throw new CartTotalTooBigError()
  const subtotalArs = itemsGross.toNumber() - kitSavings.toNumber()
  return {
    quote: {
      lines: quoteLines,
      itemsGrossArs: itemsGross.toNumber(),
      kitSavingsArs: kitSavings.toNumber(),
      subtotalArs,
      netSubtotalArs: showNetPrice ? netPrice(subtotalArs, vatRatePercent) : null,
    },
    lines,
    reservation: [...accepted].map(([productId, quantity]) => ({ productId, quantity })),
    stockChanges,
    priceChanges,
    optionErrors,
  }
}
