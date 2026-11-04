import type { SecretsPort } from '../../../../shared/application/ports/secrets.port'
import type { Clock } from '../../../../shared/domain/clock'
import { formatPesos } from '../../../../shared/domain/format-pesos'
import { newId } from '../../../../shared/domain/id'
import { normalizeEmail } from '../../../identity/domain/email'
import type { ShippingMethod } from '../../../settings/domain/store-settings.entity'
import { type CartItem, cartComboIds, cartProductIds } from '../../domain/cart-line'
import { orderCreatedEvent } from '../../domain/order-events'
import { HONEYPOT_ORDER_NUMBER } from '../../domain/order-number'
import { isPaymentMethod, type PaymentMethod } from '../../domain/order-status'
import {
  type OrderContact,
  type OrderDraft,
  placeOrder,
  reservedUntilFor,
  type ShippingAddress,
} from '../../domain/order.entity'
import {
  CartTotalTooBigError,
  CartValidationError,
  OrderConflictError,
} from '../../domain/orders-errors'
import {
  MAX_TOTAL_ARS,
  MISSING_PRODUCT_NAME,
  priceCart,
  stockChangeNotice,
} from '../../domain/pricing'
import { findShippingOption, orderShippingAddress } from '../../domain/shipping'
import type { CustomerDirectoryPort } from '../ports/customer-directory.port'
import type { OrderExpirationSchedulerPort } from '../ports/order-expiration.port'
import type { OrderRepository } from '../ports/order.repository.port'
import type { ProductCatalogPort } from '../ports/product-catalog.port'
import type { StoreSettingsPort } from '../ports/store-settings.port'
import type { CreateOrderResultView } from '../read-models'
import { toCreateOrderResult } from '../views'
import type { ExpireOrdersCommand } from './expire-orders.command'

/** Prefijo de los tokens de pedido (`ot_` + 64 hex). */
export const ORDER_TOKEN_PREFIX = 'ot_'

/** Bytes aleatorios del token de pedido (64 caracteres hex). */
export const ORDER_TOKEN_BYTES = 32

/** Pedido que arma el checkout (`CreateOrderInput` del contrato, ya validado por el DTO). */
export interface CreateOrderInput {
  /** Contacto de quien compra. */
  customer: OrderContact
  /** Envío elegido: la dirección completa en `home`, parcial en `branch`, `null` en `pickup`. */
  shipping: { method: ShippingMethod; address: ShippingAddress | null }
  /** Líneas del carrito. */
  items: CartItem[]
  /** Forma de pago. */
  paymentMethod: PaymentMethod
  /** Total con envío que vio la persona en el resumen. */
  expectedTotalArs: number
  /** Honeypot: con texto, es un bot. */
  website: string | null
}

/** Quién crea el pedido. */
export interface CreateOrderContext {
  /** Cliente de la sesión, o `null` si compra como invitado. */
  customerId: string | null
}

/**
 * Creación de un pedido (`POST /orders`): recalcula precios, kits, combos, envío y stock, reserva
 * el stock 30 minutos y deja el pedido en `pending_payment`, sin cobrar. Si algo cambió desde el
 * resumen responde 409 y no crea nada.
 */
export class CreateOrderCommand {
  /**
   * @param catalog - Productos con su stock libre y combos con sus piezas.
   * @param settings - Descuento del kit, IVA y opciones de envío.
   * @param orders - Pedidos (reserva y guardado en una transacción).
   * @param customers - Clientes, para vincular a los invitados.
   * @param secrets - Token aleatorio y SHA-256.
   * @param clock - Reloj.
   * @param scheduler - Programa el vencimiento.
   * @param expire - Vencimiento de los pedidos atrasados (se corre antes de reservar).
   */
  constructor(
    private readonly catalog: ProductCatalogPort,
    private readonly settings: StoreSettingsPort,
    private readonly orders: OrderRepository,
    private readonly customers: CustomerDirectoryPort,
    private readonly secrets: SecretsPort,
    private readonly clock: Clock,
    private readonly scheduler: OrderExpirationSchedulerPort,
    private readonly expire: ExpireOrdersCommand,
  ) {}

  /**
   * Crea el pedido. En orden: vence los atrasados, busca la opción de envío, cotiza, y responde
   * 422 (mate sin opciones), 409 `stock_changed`, `price_changed` o `total_changed` (en esa
   * precedencia); con el honeypot lleno devuelve un pedido inventado sin guardar nada; si no,
   * decide el dueño, reserva y guarda el pedido con el evento `order.created` y programa su
   * vencimiento (si programarlo falla, el pedido igual se devuelve: el barrido lo vence).
   *
   * @param input - Pedido del checkout.
   * @param context - Cliente de la sesión, si hay.
   * @returns El pedido y su token (`ot_` + 64 hex), que solo viaja en esta respuesta.
   * @throws {CartValidationError} 422: envío deshabilitado, mate sin opciones o total muy grande.
   * @throws {OrderConflictError} 409: cambió el stock, un precio o el total.
   * @throws {RangeError} En español, si `expectedTotalArs` o las líneas están fuera de rango.
   * @throws {TypeError} En español, si la forma de pago o la dirección no corresponden.
   */
  async execute(
    input: CreateOrderInput,
    context: CreateOrderContext,
  ): Promise<CreateOrderResultView> {
    if (!Number.isSafeInteger(input.expectedTotalArs) || input.expectedTotalArs < 0) {
      throw new RangeError(
        `El total esperado tiene que ser un entero no negativo (llegó ${String(input.expectedTotalArs)})`,
      )
    }
    if (!isPaymentMethod(input.paymentMethod)) {
      throw new TypeError(`La forma de pago "${String(input.paymentMethod)}" no existe`)
    }
    // Si algún pedido no se pudo vencer, el pedido nuevo sigue igual: el barrido lo reintenta.
    await this.expire.expireDue()
    const settings = await this.settings.get()
    const option = findShippingOption(
      settings.shippingOptions,
      input.shipping.method,
      'shipping.method',
    )
    // Primero los combos: sus piezas se buscan junto con los productos de las demás líneas.
    const combos = new Map(
      (await this.catalog.findCombosForCart(cartComboIds(input.items))).map((combo) => [
        combo.id,
        combo,
      ]),
    )
    const products = new Map(
      (await this.catalog.findForCart(cartProductIds(input.items, combos))).map((product) => [
        product.id,
        product,
      ]),
    )
    const priced = priceCart(input.items, products, combos, settings)
    if (priced.optionErrors.length > 0) throw new CartValidationError(priced.optionErrors)
    if (priced.stockChanges.length > 0) {
      throw new OrderConflictError('stock_changed', priced.stockChanges)
    }
    if (priced.priceChanges.length > 0) {
      throw new OrderConflictError('price_changed', priced.priceChanges)
    }
    const totalArs = priced.quote.subtotalArs + option.costArs
    if (totalArs > MAX_TOTAL_ARS) throw new CartTotalTooBigError()
    if (totalArs !== input.expectedTotalArs) {
      throw new OrderConflictError('total_changed', [
        {
          kind: 'price',
          productId: null,
          message: `El total cambió de ${formatPesos(input.expectedTotalArs)} a ${formatPesos(totalArs)}.`,
        },
      ])
    }

    const contact: OrderContact = {
      email: normalizeEmail(input.customer.email),
      firstName: input.customer.firstName,
      lastName: input.customer.lastName,
      phone: input.customer.phone,
    }
    const token = `${ORDER_TOKEN_PREFIX}${this.secrets.token(ORDER_TOKEN_BYTES)}`
    const createdAt = this.clock.now()
    const draft: OrderDraft = {
      id: newId(),
      number: null,
      customerId: context.customerId,
      contact,
      shipping: {
        method: option.method,
        address: orderShippingAddress(input.shipping.method, input.shipping.address),
        costArs: option.costArs,
        eta: option.eta,
      },
      lines: priced.lines,
      reservation: priced.reservation,
      itemsGrossArs: priced.quote.itemsGrossArs,
      kitSavingsArs: priced.quote.kitSavingsArs,
      subtotalArs: priced.quote.subtotalArs,
      totalArs,
      kitDiscountPercent: settings.kitDiscountPercent,
      paymentMethod: input.paymentMethod,
      accessTokenHash: this.secrets.sha256(token),
      createdAt,
      reservedUntil: reservedUntilFor(createdAt),
    }
    if (input.website !== null && input.website !== '') {
      return toCreateOrderResult(placeOrder(draft, HONEYPOT_ORDER_NUMBER), token)
    }

    draft.customerId = await this.ownerOf(contact, context.customerId)
    const created = await this.orders.create(draft, (order) => [orderCreatedEvent(order)])
    if (!created.ok) {
      throw new OrderConflictError(
        'stock_changed',
        created.error.map((shortage) =>
          stockChangeNotice(
            shortage.productId,
            products.get(shortage.productId)?.name ?? MISSING_PRODUCT_NAME,
            shortage.available,
          ),
        ),
      )
    }
    try {
      await this.scheduler.schedule(created.value.id, created.value.reservedUntil)
    } catch {
      // El pedido ya está guardado: sin el job, lo vencen el barrido o la lectura. No hay logger
      // acá (`application` no importa Nest); el adaptador avisa por su cuenta si la cola falla.
    }
    return toCreateOrderResult(created.value, token)
  }

  /**
   * Dueño del pedido (Ruling B-20): el cliente de la sesión; sin sesión, el invitado con ese
   * email (creado si no existe, con nombre y teléfono al día si existe). Si el email es de una
   * cuenta, el pedido queda sin dueño y solo se lee por token.
   */
  private async ownerOf(contact: OrderContact, sessionCustomerId: string | null) {
    if (sessionCustomerId !== null) return sessionCustomerId
    const existing = await this.customers.findByEmail(contact.email)
    if (existing === null) return (await this.customers.createGuest(contact)).id
    if (existing.userId !== null) return null
    const { firstName, lastName, phone } = contact
    await this.customers.updateGuest(existing.id, { firstName, lastName, phone })
    return existing.id
  }
}
