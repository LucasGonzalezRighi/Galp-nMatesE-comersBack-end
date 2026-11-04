import { LEATHERS } from '../../src/modules/catalog/domain/product.entity'
import { normalizeSearchText } from '../../src/modules/catalog/domain/search-text'
import type {
  AdminOrderFilter,
  AdminOrderRepository,
  AdminStatusEvents,
} from '../../src/modules/orders/application/ports/admin-order.repository.port'
import type { CustomerDirectoryPort } from '../../src/modules/orders/application/ports/customer-directory.port'
import type { OrderExpirationSchedulerPort } from '../../src/modules/orders/application/ports/order-expiration.port'
import type {
  OrderForPayment,
  OrderPaymentsPort,
} from '../../src/modules/orders/application/ports/order-payments.port'
import type {
  OrderEvents,
  OrderPage,
  OrderRepository,
  StockShortage,
} from '../../src/modules/orders/application/ports/order.repository.port'
import type { ProductCatalogPort } from '../../src/modules/orders/application/ports/product-catalog.port'
import type {
  OrderSettings,
  StoreSettingsPort,
} from '../../src/modules/orders/application/ports/store-settings.port'
import {
  formatOrderNumber,
  ORDER_NUMBER_SEQUENCE_START,
} from '../../src/modules/orders/domain/order-number'
import {
  AWAITING_PAYMENT_STATUSES,
  EXPIRABLE_PAYMENT_STATUSES,
  type PaymentStatus,
} from '../../src/modules/orders/domain/order-status'
import {
  type AdminStatusChange,
  isExpirable,
  isRefundable,
  markAdminStatus,
  markExpired,
  markPaid,
  markRefunded,
  type Order,
  type OrderContact,
  type OrderDraft,
  placeOrder,
} from '../../src/modules/orders/domain/order.entity'
import type {
  PricedCombo,
  PricedProduct,
  PricingSettings,
  ReservationLine,
} from '../../src/modules/orders/domain/pricing'
import type {
  ShippingMethod,
  ShippingOption,
} from '../../src/modules/settings/domain/store-settings.entity'
import type { NewDomainEvent } from '../../src/shared/domain/domain-event'
import { err, ok, type Result } from '../../src/shared/domain/result'

/**
 * Productos de prueba con los nombres, slugs y precios del seed (`prisma/seed-data/products.ts`).
 * `available` es el stock libre (`on_hand − reserved`); los mates ofrecen los cuatro cueros, como
 * en el seed, y el resto ninguno; los ids son legibles, no UUID.
 */
export const PRODUCTS = {
  imperialPremium: {
    id: 'prd-imperial-premium',
    slug: 'mate-imperial-premium',
    name: 'Mate Imperial Premium',
    group: 'mate',
    leathers: [...LEATHERS],
    priceArs: 39999,
    published: true,
    available: 12,
  },
  coquito: {
    id: 'prd-coquito-criollo',
    slug: 'mate-coquito-criollo',
    name: 'Mate Coquito Criollo',
    group: 'mate',
    leathers: [...LEATHERS],
    priceArs: 28999,
    published: true,
    available: 2,
  },
  galleta: {
    id: 'prd-galleta',
    slug: 'mate-galleta',
    name: 'Mate Galleta',
    group: 'mate',
    leathers: [...LEATHERS],
    priceArs: 27999,
    published: true,
    available: 0,
  },
  torpedoAcero: {
    id: 'prd-torpedo-acero',
    slug: 'mate-torpedo-linea-acero',
    name: 'Mate Torpedo Línea Acero',
    group: 'mate',
    leathers: [...LEATHERS],
    priceArs: null,
    published: true,
    available: 12,
  },
  bombillon100: {
    id: 'prd-bombillon-100-alpaca',
    slug: 'bombillon-100-alpaca',
    name: 'Bombillón 100% Alpaca',
    group: 'bombilla',
    leathers: [],
    priceArs: 25999,
    published: true,
    available: 12,
  },
  bombillonCurvo: {
    id: 'prd-bombillon-premium-curvo',
    slug: 'bombillon-premium-curvo',
    name: 'Bombillón Premium Curvo',
    group: 'bombilla',
    leathers: [],
    priceArs: 28999,
    published: true,
    available: 12,
  },
  yerbaCanarias: {
    id: 'prd-yerba-canarias',
    slug: 'yerba-canarias-1-kg',
    name: 'Yerba Canarias 1 kg',
    group: 'yerba',
    leathers: [],
    priceArs: 9999,
    published: true,
    available: 12,
  },
} satisfies Record<string, PricedProduct>

/**
 * Combos de prueba con los nombres y precios del mock (`fixtures/combos.ts`) sobre los
 * {@link PRODUCTS}: "Dúo Imperial" (mate + bombilla, $61.999 contra $68.998), uno sin mate y un
 * borrador con el Mate Galleta (sin stock). Los ids son legibles, no UUID.
 */
export const COMBOS = {
  duoImperial: {
    id: 'cmb-duo-imperial',
    name: 'Dúo Imperial',
    status: 'published',
    priceArs: 61999,
    productIds: [PRODUCTS.imperialPremium.id, PRODUCTS.bombillonCurvo.id],
  },
  bombillaYerba: {
    id: 'cmb-bombilla-y-yerba',
    name: 'Bombilla y yerba',
    status: 'published',
    priceArs: 31999,
    productIds: [PRODUCTS.bombillon100.id, PRODUCTS.yerbaCanarias.id],
  },
  galletaCanarias: {
    id: 'cmb-galleta-y-canarias',
    name: 'Galleta y Canarias',
    status: 'draft',
    priceArs: 33999,
    productIds: [PRODUCTS.galleta.id, PRODUCTS.yerbaCanarias.id],
  },
} satisfies Record<string, PricedCombo>

/**
 * Arma el mapa por id de combos que recibe `priceCart`.
 *
 * @param combos - Combos (por defecto, todos los de {@link COMBOS}).
 * @returns Mapa id → combo (copias).
 */
export function comboMap(
  combos: readonly PricedCombo[] = Object.values(COMBOS),
): Map<string, PricedCombo> {
  return new Map(combos.map((combo) => [combo.id, { ...combo, productIds: [...combo.productIds] }]))
}

/** Ajustes de precio del seed: 10 % de descuento en kits, IVA 21 % y precio neto visible. */
export const PRICING_SETTINGS: PricingSettings = {
  kitDiscountPercent: 10,
  vatRatePercent: 21,
  showNetPrice: true,
}

/**
 * Arma el mapa por id que recibe `priceCart`.
 *
 * @param products - Productos (por defecto, todos los de {@link PRODUCTS}).
 * @returns Mapa id → producto.
 */
export function productMap(
  products: readonly PricedProduct[] = Object.values(PRODUCTS),
): Map<string, PricedProduct> {
  return new Map(products.map((product) => [product.id, { ...product }]))
}

/** Opciones de envío del seed: domicilio 6500, sucursal 4900 y retiro gratis, todas habilitadas. */
export const SHIPPING_OPTIONS: ShippingOption[] = [
  {
    method: 'home',
    label: 'Envío a domicilio',
    costArs: 6500,
    eta: '3 a 6 días hábiles',
    enabled: true,
  },
  {
    method: 'branch',
    label: 'Envío a sucursal',
    costArs: 4900,
    eta: '3 a 6 días hábiles',
    enabled: true,
  },
  {
    method: 'pickup',
    label: 'Retiro en persona',
    costArs: 0,
    eta: 'Coordinamos por mail',
    enabled: true,
  },
]

/** Stock compartido por el catálogo y el repositorio en memoria (`on_hand` y `reserved`). */
export class InMemoryStock {
  private readonly rows = new Map<string, { onHand: number; reserved: number }>()

  /**
   * Fija el stock de un producto.
   *
   * @param productId - Producto.
   * @param onHand - Unidades físicas.
   * @param reserved - Unidades reservadas (por defecto 0).
   */
  set(productId: string, onHand: number, reserved = 0): void {
    this.rows.set(productId, { onHand, reserved })
  }

  /** @returns `on_hand − reserved` del producto (0 si no tiene fila). */
  available(productId: string): number {
    const row = this.rows.get(productId)
    return row === undefined ? 0 : row.onHand - row.reserved
  }

  /** @returns Las unidades reservadas del producto. */
  reserved(productId: string): number {
    return this.rows.get(productId)?.reserved ?? 0
  }

  /** @returns Las unidades físicas del producto (`on_hand`). */
  onHand(productId: string): number {
    return this.rows.get(productId)?.onHand ?? 0
  }

  /**
   * Reserva todo o nada, como el `UPDATE … WHERE on_hand − reserved >= q` en una transacción.
   *
   * @param lines - Unidades por producto.
   * @returns Los productos que no alcanzaron (vacío si reservó).
   */
  reserve(lines: readonly ReservationLine[]): StockShortage[] {
    const shortages = [...lines]
      .sort((a, b) => a.productId.localeCompare(b.productId))
      .filter((line) => this.available(line.productId) < line.quantity)
      .map((line) => ({
        productId: line.productId,
        available: Math.max(0, this.available(line.productId)),
      }))
    if (shortages.length > 0) return shortages
    for (const line of lines) {
      const row = this.rows.get(line.productId)
      if (row !== undefined) row.reserved += line.quantity
    }
    return []
  }

  /**
   * Libera lo reservado.
   *
   * @param lines - Unidades por producto.
   */
  release(lines: readonly ReservationLine[]): void {
    for (const line of lines) {
      const row = this.rows.get(line.productId)
      if (row !== undefined) row.reserved = Math.max(0, row.reserved - line.quantity)
    }
  }

  /**
   * Confirma lo reservado al pagar: baja `on_hand` y `reserved`.
   *
   * @param lines - Unidades por producto.
   */
  commit(lines: readonly ReservationLine[]): void {
    for (const line of lines) {
      const row = this.rows.get(line.productId)
      if (row !== undefined) {
        row.onHand -= line.quantity
        row.reserved = Math.max(0, row.reserved - line.quantity)
      }
    }
  }
}

/** {@link ProductCatalogPort} en memoria: productos de prueba con el stock de {@link InMemoryStock}. */
export class InMemoryProductCatalog implements ProductCatalogPort {
  private readonly products = new Map<string, PricedProduct>()
  private readonly combos: Map<string, PricedCombo>
  /** Ids pedidos en cada llamada. */
  readonly calls: string[][] = []

  /**
   * @param stock - Stock compartido; se carga con el `available` de cada producto.
   * @param products - Productos (por defecto, todos los de {@link PRODUCTS}).
   * @param combos - Combos (por defecto, todos los de {@link COMBOS}).
   */
  constructor(
    private readonly stock: InMemoryStock,
    products: readonly PricedProduct[] = Object.values(PRODUCTS),
    combos: readonly PricedCombo[] = Object.values(COMBOS),
  ) {
    for (const product of products) {
      this.products.set(product.id, { ...product })
      stock.set(product.id, product.available)
    }
    this.combos = comboMap(combos)
  }

  /**
   * Cambia datos de un combo (precio, estado, piezas…).
   *
   * @param comboId - Combo.
   * @param changes - Campos a cambiar.
   */
  updateCombo(comboId: string, changes: Partial<Omit<PricedCombo, 'id'>>): void {
    const combo = this.combos.get(comboId)
    if (combo === undefined) throw new Error(`No existe el combo de prueba ${comboId}`)
    this.combos.set(comboId, { ...combo, ...changes })
  }

  /** {@inheritDoc ProductCatalogPort.findCombosForCart} */
  findCombosForCart(ids: readonly string[]): Promise<PricedCombo[]> {
    return Promise.resolve(
      ids.flatMap((id) => {
        const combo = this.combos.get(id)
        return combo === undefined ? [] : [{ ...combo, productIds: [...combo.productIds] }]
      }),
    )
  }

  /**
   * Cambia datos de un producto (precio, publicación…).
   *
   * @param productId - Producto.
   * @param changes - Campos a cambiar.
   */
  update(productId: string, changes: Partial<Omit<PricedProduct, 'id' | 'available'>>): void {
    const product = this.products.get(productId)
    if (product === undefined) throw new Error(`No existe el producto de prueba ${productId}`)
    this.products.set(productId, { ...product, ...changes })
  }

  /** {@inheritDoc ProductCatalogPort.findForCart} */
  findForCart(ids: readonly string[]): Promise<PricedProduct[]> {
    this.calls.push([...ids])
    return Promise.resolve(
      ids.flatMap((id) => {
        const product = this.products.get(id)
        return product === undefined ? [] : [{ ...product, available: this.stock.available(id) }]
      }),
    )
  }
}

/** {@link StoreSettingsPort} fijo: los ajustes del seed, con cambios opcionales. */
export class FixedStoreSettings implements StoreSettingsPort {
  /** Ajustes que devuelve `get` (se pueden cambiar en el test). */
  settings: OrderSettings

  /** @param overrides - Cambios sobre los ajustes del seed. */
  constructor(overrides: Partial<OrderSettings> = {}) {
    this.settings = {
      ...PRICING_SETTINGS,
      shippingOptions: SHIPPING_OPTIONS.map((option) => ({ ...option })),
      ...overrides,
    }
  }

  /**
   * Habilita o deshabilita un método de envío.
   *
   * @param method - Método.
   * @param enabled - Si se puede elegir.
   */
  setEnabled(method: ShippingMethod, enabled: boolean): void {
    for (const option of this.settings.shippingOptions) {
      if (option.method === method) option.enabled = enabled
    }
  }

  /** {@inheritDoc StoreSettingsPort.get} */
  get(): Promise<OrderSettings> {
    return Promise.resolve(structuredClone(this.settings))
  }
}

/**
 * {@link OrderRepository} en memoria con las reglas del adaptador Prisma: números desde
 * `GLP-10001`, reserva de todo o nada en {@link InMemoryStock}, vencimiento condicional e
 * idempotente y eventos armados con el pedido ya guardado.
 */
export class InMemoryOrderRepository implements OrderRepository {
  /** Pedidos guardados. */
  readonly orders: Order[] = []
  /** Eventos guardados en el "outbox". */
  readonly events: NewDomainEvent[] = []
  /** Borradores recibidos por `create` (también los que no alcanzaron stock). */
  readonly drafts: OrderDraft[] = []
  /** Cuántas veces `expire` venció de verdad un pedido. */
  expirations = 0
  /** Reservas activas por id de pedido (vacías una vez liberadas o confirmadas). */
  readonly reservations = new Map<string, ReservationLine[]>()
  private sequence = ORDER_NUMBER_SEQUENCE_START

  /** @param stock - Stock compartido con el catálogo. */
  constructor(private readonly stock: InMemoryStock) {}

  /**
   * Cambia un pedido guardado (por ejemplo, su `paymentStatus`) para preparar un caso.
   *
   * @param number - Número del pedido.
   * @param changes - Campos a cambiar.
   */
  update(number: string, changes: Partial<Order>): void {
    const index = this.orders.findIndex((order) => order.number === number)
    const order = this.orders[index]
    if (order === undefined) throw new Error(`No existe el pedido de prueba ${number}`)
    this.orders[index] = { ...order, ...changes }
  }

  /** {@inheritDoc OrderRepository.create} */
  create(draft: OrderDraft, events: OrderEvents): Promise<Result<Order, StockShortage[]>> {
    this.drafts.push(structuredClone(draft))
    const shortages = this.stock.reserve(draft.reservation)
    if (shortages.length > 0) return Promise.resolve(err(shortages))
    const order = placeOrder(draft, formatOrderNumber(this.sequence))
    this.sequence += 1
    this.orders.push(order)
    this.reservations.set(
      order.id,
      draft.reservation.map((line) => ({ ...line })),
    )
    this.events.push(...events(structuredClone(order)))
    return Promise.resolve(ok(structuredClone(order)))
  }

  /** {@inheritDoc OrderRepository.findByNumber} */
  findByNumber(number: string): Promise<Order | null> {
    const order = this.orders.find((candidate) => candidate.number === number)
    return Promise.resolve(order === undefined ? null : structuredClone(order))
  }

  /** {@inheritDoc OrderRepository.listByCustomer} */
  listByCustomer(customerId: string, page: number, pageSize: number): Promise<OrderPage> {
    const owned = this.orders
      .filter((order) => order.customerId === customerId)
      .sort(
        (a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.number.localeCompare(a.number),
      )
    const start = (page - 1) * pageSize
    return Promise.resolve({
      items: owned.slice(start, start + pageSize).map((order) => structuredClone(order)),
      total: owned.length,
    })
  }

  /** {@inheritDoc OrderRepository.expire} */
  expire(orderId: string, now: Date, events: OrderEvents): Promise<Order | null> {
    const index = this.orders.findIndex((order) => order.id === orderId)
    const order = this.orders[index]
    if (order === undefined || !isExpirable(order, now)) return Promise.resolve(null)
    const expired = markExpired(order, now)
    this.orders[index] = expired
    this.stock.release(this.reservations.get(orderId) ?? [])
    this.reservations.set(orderId, [])
    this.expirations += 1
    this.events.push(...events(structuredClone(expired)))
    return Promise.resolve(structuredClone(expired))
  }

  /** {@inheritDoc OrderRepository.findDue} */
  findDue(now: Date, limit: number): Promise<Order[]> {
    return Promise.resolve(
      this.orders
        .filter((order) => isExpirable(order, now))
        .sort((a, b) => a.reservedUntil.getTime() - b.reservedUntil.getTime())
        .slice(0, limit)
        .map((order) => structuredClone(order)),
    )
  }
}

/** Pedido → lo que `payments` necesita para cobrarlo (las líneas no tienen id: se arma uno). */
function toOrderForPayment(order: Order): OrderForPayment {
  return {
    id: order.id,
    number: order.number,
    status: order.status,
    paymentStatus: order.paymentStatus,
    paymentMethod: order.paymentMethod,
    totalArs: order.totalArs,
    shippingCostArs: order.shipping.costArs,
    accessTokenHash: order.accessTokenHash,
    reservedUntil: order.reservedUntil,
    createdAt: order.createdAt,
    customerId: order.customerId,
    contact: { ...order.contact },
    lines: order.lines.map((line, position) => ({
      id: `${order.id}-line-${String(position + 1)}`,
      name: line.name,
      quantity: line.quantity,
      totalArs: line.totalArs,
    })),
  }
}

/**
 * {@link OrderPaymentsPort} en memoria sobre el mismo almacén que {@link InMemoryOrderRepository}
 * (pedidos, reservas y eventos) y el mismo {@link InMemoryStock}, con las reglas del adaptador
 * Prisma: paga solo un pedido `pending_payment` (una vez) confirmando sus reservas
 * (`on_hand − q`, `reserved − q`) y devuelve solo un pedido cobrado (el stock no vuelve).
 */
export class InMemoryOrderPayments implements OrderPaymentsPort {
  /** Cuántas veces `markPaid` pagó de verdad un pedido. */
  paidCount = 0
  /** Cuántas veces `markRefunded` devolvió de verdad un pedido. */
  refundedCount = 0
  /** Cambios de `payment_status` pedidos con `setPaymentStatus`, en orden. */
  readonly paymentStatusChanges: { orderId: string; status: PaymentStatus }[] = []

  /**
   * @param repository - Repositorio de pedidos en memoria (el mismo almacén).
   * @param stock - Stock compartido con el repositorio y el catálogo.
   */
  constructor(
    private readonly repository: InMemoryOrderRepository,
    private readonly stock: InMemoryStock,
  ) {}

  /** {@inheritDoc OrderPaymentsPort.findForPayment} */
  findForPayment(number: string): Promise<OrderForPayment | null> {
    const order = this.repository.orders.find((candidate) => candidate.number === number)
    return Promise.resolve(order === undefined ? null : toOrderForPayment(structuredClone(order)))
  }

  /** {@inheritDoc OrderPaymentsPort.findForPaymentById} */
  findForPaymentById(orderId: string): Promise<OrderForPayment | null> {
    const order = this.repository.orders.find((candidate) => candidate.id === orderId)
    return Promise.resolve(order === undefined ? null : toOrderForPayment(structuredClone(order)))
  }

  /** {@inheritDoc OrderPaymentsPort.markPaid} */
  markPaid(orderId: string, paidAt: Date, events: OrderEvents): Promise<Order | null> {
    const index = this.repository.orders.findIndex((order) => order.id === orderId)
    const order = this.repository.orders[index]
    if (order?.status !== 'pending_payment') return Promise.resolve(null)
    const paid = markPaid(order, paidAt)
    this.repository.orders[index] = paid
    this.stock.commit(this.repository.reservations.get(orderId) ?? [])
    this.repository.reservations.set(orderId, [])
    this.paidCount += 1
    this.repository.events.push(...events(structuredClone(paid)))
    return Promise.resolve(structuredClone(paid))
  }

  /** {@inheritDoc OrderPaymentsPort.setPaymentStatus} */
  setPaymentStatus(orderId: string, status: PaymentStatus): Promise<void> {
    this.paymentStatusChanges.push({ orderId, status })
    const index = this.repository.orders.findIndex((order) => order.id === orderId)
    const order = this.repository.orders[index]
    if (order !== undefined) this.repository.orders[index] = { ...order, paymentStatus: status }
    return Promise.resolve()
  }

  /** {@inheritDoc OrderPaymentsPort.markRefunded} */
  markRefunded(orderId: string, at: Date, events: OrderEvents): Promise<Order | null> {
    const index = this.repository.orders.findIndex((order) => order.id === orderId)
    const order = this.repository.orders[index]
    if (order === undefined || !isRefundable(order)) return Promise.resolve(null)
    const refunded = markRefunded(order, at)
    this.repository.orders[index] = refunded
    this.refundedCount += 1
    this.repository.events.push(...events(structuredClone(refunded)))
    return Promise.resolve(structuredClone(refunded))
  }

  /** {@inheritDoc OrderPaymentsPort.listAwaitingPayment} */
  listAwaitingPayment(cutoff: Date, limit: number): Promise<OrderForPayment[]> {
    return Promise.resolve(
      this.repository.orders
        .filter(
          (order) =>
            order.status === 'pending_payment' &&
            (AWAITING_PAYMENT_STATUSES as readonly PaymentStatus[]).includes(order.paymentStatus) &&
            order.reservedUntil.getTime() <= cutoff.getTime(),
        )
        .sort((a, b) => a.reservedUntil.getTime() - b.reservedUntil.getTime())
        .slice(0, limit)
        .map((order) => toOrderForPayment(structuredClone(order))),
    )
  }
}

/** Cliente guardado en {@link InMemoryCustomerDirectory}. */
export interface DirectoryRecord extends OrderContact {
  /** Id del cliente. */
  id: string
  /** Usuario de la cuenta, o `null` si es invitado. */
  userId: string | null
}

/** {@link CustomerDirectoryPort} en memoria; el email se compara sin mayúsculas (como `citext`). */
export class InMemoryCustomerDirectory implements CustomerDirectoryPort {
  /** Clientes guardados. */
  readonly customers: DirectoryRecord[] = []
  private counter = 0

  /**
   * Agrega un cliente para preparar un caso.
   *
   * @param record - Datos del cliente; sin `id`, se genera uno.
   * @returns El cliente guardado.
   */
  add(record: Omit<DirectoryRecord, 'id'> & { id?: string }): DirectoryRecord {
    this.counter += 1
    const saved = { ...record, id: record.id ?? `cus-${String(this.counter)}` }
    this.customers.push(saved)
    return saved
  }

  /** {@inheritDoc CustomerDirectoryPort.findByEmail} */
  findByEmail(email: string): Promise<{ id: string; userId: string | null } | null> {
    const found = this.find(email)
    return Promise.resolve(found === undefined ? null : { id: found.id, userId: found.userId })
  }

  /** {@inheritDoc CustomerDirectoryPort.createGuest} */
  createGuest(input: OrderContact): Promise<{ id: string }> {
    const existing = this.find(input.email)
    if (existing !== undefined) return Promise.resolve({ id: existing.id })
    return Promise.resolve({ id: this.add({ ...input, userId: null }).id })
  }

  /** {@inheritDoc CustomerDirectoryPort.updateGuest} */
  updateGuest(id: string, input: Omit<OrderContact, 'email'>): Promise<void> {
    const customer = this.customers.find((candidate) => candidate.id === id)
    if (customer?.userId !== null) {
      return Promise.reject(new Error(`No hay un invitado de prueba con id ${id}`))
    }
    Object.assign(customer, input)
    return Promise.resolve()
  }

  private find(email: string): DirectoryRecord | undefined {
    return this.customers.find((customer) => customer.email.toLowerCase() === email.toLowerCase())
  }
}

/** {@link OrderExpirationSchedulerPort} que anota lo programado. */
export class RecordingExpirationScheduler implements OrderExpirationSchedulerPort {
  /** Vencimientos programados, en orden. */
  readonly scheduled: { orderId: string; at: Date }[] = []

  /** {@inheritDoc OrderExpirationSchedulerPort.schedule} */
  schedule(orderId: string, at: Date): Promise<void> {
    this.scheduled.push({ orderId, at })
    return Promise.resolve()
  }
}

/**
 * {@link AdminOrderRepository} en memoria sobre el mismo almacén que {@link InMemoryOrderRepository}
 * (pedidos, reservas y eventos) y el mismo {@link InMemoryStock}, con las reglas del adaptador
 * Prisma: el listado filtra por estados, pago y texto normalizado, del más nuevo al más viejo; el
 * cambio es condicional (si el pedido ya no está como se leyó, `null`), cancelar libera la reserva
 * y el intento activo del pedido (si su último pago sigue abierto) sale como `<id>:attempt`.
 */
export class InMemoryAdminOrderRepository implements AdminOrderRepository {
  /**
   * @param store - Pedidos, reservas y eventos.
   * @param stock - Stock compartido.
   */
  constructor(
    private readonly store: InMemoryOrderRepository,
    private readonly stock: InMemoryStock,
  ) {}

  /** {@inheritDoc AdminOrderRepository.list} */
  list(filter: AdminOrderFilter, page: number, pageSize: number): Promise<OrderPage> {
    const matching = this.store.orders
      .filter(
        (order) =>
          (filter.statuses.length === 0 || filter.statuses.includes(order.status)) &&
          (filter.paymentStatus === null || order.paymentStatus === filter.paymentStatus) &&
          (filter.q === null ||
            normalizeSearchText(
              `${order.number} ${order.contact.firstName} ${order.contact.lastName} ${order.contact.email}`,
            ).includes(filter.q)),
      )
      .sort(
        (a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.number.localeCompare(a.number),
      )
    const start = (page - 1) * pageSize
    return Promise.resolve({
      items: matching.slice(start, start + pageSize).map((order) => structuredClone(order)),
      total: matching.length,
    })
  }

  /** {@inheritDoc AdminOrderRepository.changeStatus} */
  changeStatus(
    order: Order,
    change: AdminStatusChange,
    at: Date,
    events: AdminStatusEvents,
  ): Promise<Order | null> {
    const index = this.store.orders.findIndex((candidate) => candidate.id === order.id)
    const current = this.store.orders[index]
    if (current?.status !== order.status) return Promise.resolve(null)
    const cancelling = change.status === 'cancelled'
    if (
      cancelling &&
      !(EXPIRABLE_PAYMENT_STATUSES as readonly PaymentStatus[]).includes(current.paymentStatus)
    ) {
      return Promise.resolve(null)
    }
    const changed = markAdminStatus(current, change, at)
    this.store.orders[index] = changed
    let cancelledAttemptId: string | null = null
    if (cancelling) {
      this.stock.release(this.store.reservations.get(order.id) ?? [])
      this.store.reservations.set(order.id, [])
      if (current.payment !== null && current.payment.status !== changed.payment?.status) {
        cancelledAttemptId = `${order.id}:attempt`
      }
    }
    this.store.events.push(...events(cancelledAttemptId))
    return Promise.resolve(structuredClone(changed))
  }
}
