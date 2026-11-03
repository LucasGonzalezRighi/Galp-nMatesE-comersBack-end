import { Prisma } from '../../../generated/prisma/client'
import { PRODUCT_GROUPS } from '../../catalog/domain/category.entity'
import { FERRULES, LEATHERS } from '../../catalog/domain/product.entity'
import { isProvince } from '../../identity/domain/province'
import type { CartItemOptions, Ferrule, Leather } from '../domain/cart-line'
import type { Order } from '../domain/order.entity'
import type { OrderKitItemDraft, OrderLineDraft } from '../domain/pricing'
import type { ShippingAddress } from '../domain/shipping'

/** Formato de un UUID (las columnas `uuid` de Postgres rechazan cualquier otro texto). */
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Relaciones que se leen con cada pedido: líneas por posición con sus piezas, el historial del
 * más viejo al más nuevo y el despacho.
 */
export const ORDER_INCLUDE = {
  items: { orderBy: { position: 'asc' }, include: { components: true } },
  history: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
  shipment: { select: { carrier: true, trackingNumber: true } },
} satisfies Prisma.OrderInclude

/** Fila de `orders` con las relaciones de {@link ORDER_INCLUDE}. */
export type OrderRow = Prisma.OrderGetPayload<{ include: typeof ORDER_INCLUDE }>

/** Objeto JSON (no array), o `null` si el valor es otra cosa. */
function jsonObject(json: Prisma.JsonValue): Prisma.JsonObject | null {
  return json !== null && typeof json === 'object' && !Array.isArray(json) ? json : null
}

/** Texto de un campo de un objeto JSON, o `undefined` si no es texto. */
function text(json: Prisma.JsonObject, field: string): string | undefined {
  const value = json[field]
  return typeof value === 'string' ? value : undefined
}

function isLeather(value: string | undefined): value is Leather {
  return value !== undefined && (LEATHERS as readonly string[]).includes(value)
}

function isFerrule(value: string | undefined): value is Ferrule {
  return value !== undefined && (FERRULES as readonly string[]).includes(value)
}

/**
 * Lee el destino guardado en `orders.shipping_address` (jsonb).
 *
 * @param json - Valor de la columna.
 * @returns La dirección completa (si tiene calle), el destino de sucursal, o `null`.
 * @throws {TypeError} En español, si el JSON no tiene la forma de un `ShippingAddress`.
 */
export function toShippingAddress(json: Prisma.JsonValue): ShippingAddress | null {
  if (json === null) return null
  const object = jsonObject(json)
  const postalCode = object === null ? undefined : text(object, 'postalCode')
  const city = object === null ? undefined : text(object, 'city')
  const province = object === null ? undefined : text(object, 'province')
  if (
    object === null ||
    postalCode === undefined ||
    city === undefined ||
    province === undefined ||
    !isProvince(province)
  ) {
    throw new TypeError('La dirección de envío guardada en el pedido no es válida')
  }
  if (!('street' in object)) return { postalCode, city, province }
  const street = text(object, 'street')
  const number = text(object, 'number')
  const apartment = object.apartment === null ? null : text(object, 'apartment')
  if (street === undefined || number === undefined || apartment === undefined) {
    throw new TypeError('La dirección de envío guardada en el pedido no es válida')
  }
  return { street, number, apartment, postalCode, city, province }
}

/**
 * Lee las opciones guardadas en `order_items.options` (jsonb).
 *
 * @param json - Valor de la columna.
 * @returns Cuero y virola, o `null`.
 * @throws {TypeError} En español, si el JSON no es un cuero y una virola del catálogo.
 */
export function toCartItemOptions(json: Prisma.JsonValue): CartItemOptions | null {
  if (json === null) return null
  const object = jsonObject(json)
  const leather = object === null ? undefined : text(object, 'leather')
  const ferrule = object === null ? undefined : text(object, 'ferrule')
  if (!isLeather(leather) || !isFerrule(ferrule)) {
    throw new TypeError('Las opciones guardadas en la línea del pedido no son válidas')
  }
  return { leather, ferrule }
}

/**
 * Valor para escribir un destino en la columna jsonb `shipping_address`.
 *
 * @param address - Destino, o `null` en el retiro.
 * @returns El objeto JSON, o `Prisma.DbNull`.
 */
export function shippingAddressJson(
  address: ShippingAddress | null,
): Prisma.InputJsonObject | typeof Prisma.DbNull {
  if (address === null) return Prisma.DbNull
  return { ...address }
}

/**
 * Valor para escribir las opciones de una línea en la columna jsonb `options`.
 *
 * @param options - Cuero y virola, o `null`.
 * @returns El objeto JSON, o `Prisma.DbNull`.
 */
export function cartItemOptionsJson(
  options: CartItemOptions | null,
): Prisma.InputJsonObject | typeof Prisma.DbNull {
  if (options === null) return Prisma.DbNull
  return { leather: options.leather, ferrule: options.ferrule }
}

/** Línea guardada → línea del dominio, con las piezas del kit en orden mate, bombilla, yerba. */
function toLine(item: OrderRow['items'][number]): OrderLineDraft {
  const kitItems: OrderKitItemDraft[] | null =
    item.lineType === 'kit'
      ? [...item.components]
          .sort((a, b) => PRODUCT_GROUPS.indexOf(a.role) - PRODUCT_GROUPS.indexOf(b.role))
          .map((piece) => ({
            role: piece.role,
            productId: piece.productId,
            slug: piece.slug,
            name: piece.name,
            unitPriceArs: piece.unitPriceArs,
          }))
      : null
  return {
    type: item.lineType,
    name: item.name,
    detail: item.detail,
    quantity: item.quantity,
    unitPriceArs: item.unitPriceArs,
    kitSavingsArs: item.kitSavingsArs,
    totalArs: item.totalArs,
    productId: item.productId,
    productSlug: item.productSlug,
    options: toCartItemOptions(item.options),
    kitItems,
  }
}

/**
 * Convierte una fila de `orders` (con {@link ORDER_INCLUDE}) en el pedido del dominio.
 *
 * @param row - Fila leída con Prisma.
 * @returns El pedido, con las líneas por posición y el historial del más viejo al más nuevo.
 * @throws {TypeError} En español, si la dirección o las opciones guardadas no son válidas.
 */
export function toOrder(row: OrderRow): Order {
  return {
    id: row.id,
    number: row.number,
    customerId: row.customerId,
    status: row.status,
    paymentStatus: row.paymentStatus,
    paymentMethod: row.paymentMethod,
    contact: {
      email: row.contactEmail,
      firstName: row.contactFirstName,
      lastName: row.contactLastName,
      phone: row.contactPhone,
    },
    shipping: {
      method: row.shippingMethod,
      address: toShippingAddress(row.shippingAddress),
      costArs: row.shippingCostArs,
      eta: row.shippingEta,
    },
    lines: row.items.map(toLine),
    itemsGrossArs: row.itemsGrossArs,
    kitSavingsArs: row.kitSavingsArs,
    subtotalArs: row.subtotalArs,
    totalArs: row.totalArs,
    kitDiscountPercent: row.kitDiscountPercent,
    accessTokenHash: row.accessTokenHash,
    createdAt: row.createdAt,
    reservedUntil: row.reservedUntil,
    history: row.history.map((entry) => ({
      status: entry.toStatus,
      at: entry.createdAt,
      note: entry.note,
    })),
    tracking:
      row.shipment === null
        ? null
        : { carrier: row.shipment.carrier, number: row.shipment.trackingNumber },
  }
}
