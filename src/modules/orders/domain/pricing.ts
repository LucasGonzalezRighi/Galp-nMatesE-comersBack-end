import type { ChangeNotice, FieldError } from '../../../shared/domain/change-notice'
import { Pesos } from '../../../shared/domain/pesos'
import type { ProductGroup } from '../../catalog/domain/category.entity'
import { MAX_QUANTITY_PER_PRODUCT } from '../../catalog/domain/inventory.entity'
import {
  type CartItem,
  type CartItemOptions,
  cartLineKey,
  KIT_FERRULE,
  KIT_LINE_NAME,
  leatherLabel,
  MAX_CART_LINES,
} from './cart-line'
import { formatPesos } from './format-pesos'
import type { LineType } from './order-status'
import { CartTotalTooBigError } from './orders-errors'

/** Tope de los montos que suman o multiplican otros (`TotalArs`: el máximo de un entero de 32 bits). */
export const MAX_TOTAL_ARS = 2_147_483_647

/** Nombre de una línea cuyo producto no existe. */
export const MISSING_PRODUCT_NAME = 'Producto no disponible'

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
  /** Precio de lista, o `null` si es "a consultar" (no se vende). */
  priceArs: number | null
  /** Si está publicado. */
  published: boolean
  /** Stock libre: `on_hand − reserved`. */
  available: number
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
  /** Producto suelto o kit. */
  type: LineType
  /** Nombre del producto, `Kit` o `Producto no disponible`. */
  name: string
  /** Opciones elegidas; vacío si no hay. */
  detail: string
  /** Precio de lista de una unidad (en un kit, la suma de las tres piezas). */
  unitPriceArs: number
  /** Neto de lo que paga el cliente por unidad, o `null` con `showNetPrice` apagado. */
  netUnitPriceArs: number | null
  /** Ahorro por kit de toda la línea. */
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
  /** Suma de los ahorros por kit. */
  kitSavingsArs: number
  /** `itemsGrossArs − kitSavingsArs`. */
  subtotalArs: number
  /** Neto del subtotal, o `null` con `showNetPrice` apagado. */
  netSubtotalArs: number | null
}

/** Pieza de un kit tal como se compró. */
export interface OrderKitItemDraft {
  /** Rol de la pieza en el kit. */
  role: ProductGroup
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
  /** Producto suelto o kit. */
  type: LineType
  /** Nombre del producto o `Kit`. */
  name: string
  /** Opciones elegidas; vacío si no hay. */
  detail: string
  /** Unidades compradas (ya reducidas al stock). */
  quantity: number
  /** Precio de lista de una unidad. */
  unitPriceArs: number
  /** Ahorro por kit de la línea. */
  kitSavingsArs: number
  /** Importe de la línea. */
  totalArs: number
  /** Id del producto suelto; `null` en un kit. */
  productId: string | null
  /** Slug del producto suelto; `null` en un kit. */
  productSlug: string | null
  /** Cuero y virola de un mate o del kit; `null` en los demás productos. */
  options: CartItemOptions | null
  /** Las tres piezas de un kit; `null` si no es un kit. */
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
  /** Mates que llegaron sin cuero ni virola (`items.{i}.options`). */
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
 * stock compartidos por producto entre todas las líneas (sueltas y piezas de kits). Una línea con
 * problemas no hace fallar la cotización: se informa en `issue` y en los avisos.
 *
 * - Pieza inexistente, no publicada, sin precio o de otro grupo → `unavailable`.
 * - Sin lugar → `sold_out`; con menos lugar que lo pedido → `quantity_reduced` (se cotiza el máximo).
 * - `expectedUnitPriceArs` distinto del vigente → `price_changed` (pierde contra el stock).
 * - Ahorro del kit por unidad (`Pesos.percentOf`) por la cantidad; netos redondeados.
 *
 * @param items - Líneas del carrito (de 1 a 50, cantidades de 1 a 20).
 * @param products - Productos por id (los que no están cuentan como inexistentes).
 * @param settings - Descuento del kit, IVA y si se muestran los netos.
 * @returns La cotización, las líneas compradas, la reserva y los avisos.
 * @throws {CartTotalTooBigError} Si la suma de las líneas pasa de {@link MAX_TOTAL_ARS}.
 * @throws {RangeError} En español, si las líneas, las cantidades o los ajustes están fuera de rango.
 */
export function priceCart(
  items: readonly CartItem[],
  products: ReadonlyMap<string, PricedProduct>,
  settings: PricingSettings,
): PricedCart {
  assertPricingInput(items, settings)
  const { kitDiscountPercent, vatRatePercent, showNetPrice } = settings
  const accepted = new Map<string, number>()
  const quoteLines: CartQuoteLine[] = []
  const lines: OrderLineDraft[] = []
  const stockChanges: ChangeNotice[] = []
  const priceChanges: ChangeNotice[] = []
  const optionErrors: FieldError[] = []
  let itemsGross = Pesos.of(0)
  let kitSavings = Pesos.of(0)

  items.forEach((item, index) => {
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
    const first = found[0]
    const isMate = item.type === 'product' && first?.group === 'mate'
    const options = item.type === 'product' && isMate ? item.options : null
    if (isMate && options === null && sellable[0] !== undefined) {
      optionErrors.push({
        field: `items.${String(index)}.options`,
        code: 'required',
        message: 'Elegí el cuero y la virola del mate.',
      })
    }
    const name = item.type === 'kit' ? KIT_LINE_NAME : (first?.name ?? MISSING_PRODUCT_NAME)
    const base = {
      key: cartLineKey(item, isMate),
      type: item.type,
      name,
      detail:
        item.type === 'kit'
          ? `${found.map((product) => product?.name ?? MISSING_PRODUCT_NAME).join(' + ')} · ${leatherLabel(item.leather)}`
          : options === null
            ? ''
            : `${leatherLabel(options.leather)} · ${options.ferrule}`,
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
      options: item.type === 'kit' ? { leather: item.leather, ferrule: KIT_FERRULE } : options,
      kitItems:
        item.type === 'kit'
          ? sold.map((product, position) => ({
              role: pieces[position]?.[1] ?? product.group,
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
