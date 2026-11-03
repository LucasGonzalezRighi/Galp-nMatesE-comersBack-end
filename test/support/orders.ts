import type { CustomerDirectoryPort } from '../../src/modules/orders/application/ports/customer-directory.port'
import type { OrderExpirationSchedulerPort } from '../../src/modules/orders/application/ports/order-expiration.port'
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
  isExpirable,
  markExpired,
  type Order,
  type OrderContact,
  type OrderDraft,
  placeOrder,
} from '../../src/modules/orders/domain/order.entity'
import type {
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
 * `available` es el stock libre (`on_hand − reserved`); los ids son legibles, no UUID.
 */
export const PRODUCTS = {
  imperialPremium: {
    id: 'prd-imperial-premium',
    slug: 'mate-imperial-premium',
    name: 'Mate Imperial Premium',
    group: 'mate',
    priceArs: 39999,
    published: true,
    available: 12,
  },
  coquito: {
    id: 'prd-coquito-criollo',
    slug: 'mate-coquito-criollo',
    name: 'Mate Coquito Criollo',
    group: 'mate',
    priceArs: 28999,
    published: true,
    available: 2,
  },
  galleta: {
    id: 'prd-galleta',
    slug: 'mate-galleta',
    name: 'Mate Galleta',
    group: 'mate',
    priceArs: 27999,
    published: true,
    available: 0,
  },
  torpedoAcero: {
    id: 'prd-torpedo-acero',
    slug: 'mate-torpedo-linea-acero',
    name: 'Mate Torpedo Línea Acero',
    group: 'mate',
    priceArs: null,
    published: true,
    available: 12,
  },
  bombillon100: {
    id: 'prd-bombillon-100-alpaca',
    slug: 'bombillon-100-alpaca',
    name: 'Bombillón 100% Alpaca',
    group: 'bombilla',
    priceArs: 25999,
    published: true,
    available: 12,
  },
  bombillonCurvo: {
    id: 'prd-bombillon-premium-curvo',
    slug: 'bombillon-premium-curvo',
    name: 'Bombillón Premium Curvo',
    group: 'bombilla',
    priceArs: 28999,
    published: true,
    available: 12,
  },
  yerbaCanarias: {
    id: 'prd-yerba-canarias',
    slug: 'yerba-canarias-1-kg',
    name: 'Yerba Canarias 1 kg',
    group: 'yerba',
    priceArs: 9999,
    published: true,
    available: 12,
  },
} satisfies Record<string, PricedProduct>

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
}

/** {@link ProductCatalogPort} en memoria: productos de prueba con el stock de {@link InMemoryStock}. */
export class InMemoryProductCatalog implements ProductCatalogPort {
  private readonly products = new Map<string, PricedProduct>()
  /** Ids pedidos en cada llamada. */
  readonly calls: string[][] = []

  /**
   * @param stock - Stock compartido; se carga con el `available` de cada producto.
   * @param products - Productos (por defecto, todos los de {@link PRODUCTS}).
   */
  constructor(
    private readonly stock: InMemoryStock,
    products: readonly PricedProduct[] = Object.values(PRODUCTS),
  ) {
    for (const product of products) {
      this.products.set(product.id, { ...product })
      stock.set(product.id, product.available)
    }
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
  private readonly reservations = new Map<string, ReservationLine[]>()
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
