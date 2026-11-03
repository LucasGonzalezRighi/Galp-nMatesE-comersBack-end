import type { ShippingMethod } from '../../settings/domain/store-settings.entity'
import type { CustomerView } from '../../identity/application/read-models'
import type { CartItemOptions } from '../domain/cart-line'
import type { ShippingAddress } from '../domain/shipping'
import type { LineType, OrderStatus, PaymentMethod, PaymentStatus } from '../domain/order-status'

export type { CartQuote, CartQuoteLine, LineIssue } from '../domain/pricing'

/** Costo y plazo de un envío (`ShippingQuote` del contrato). */
export interface ShippingQuote {
  /** Método. */
  method: ShippingMethod
  /** Costo en pesos; 0 si es gratis. */
  costArs: number
  /** Plazo estimado. */
  eta: string
}

/** Pieza de un kit en un pedido (`OrderLine.kitItems[]`). */
export interface OrderKitItemView {
  /** Slug al comprar. */
  slug: string
  /** Nombre. */
  name: string
  /** Precio de lista de la pieza. */
  unitPriceArs: number
}

/** Línea de un pedido (`OrderLine` del contrato). */
export interface OrderLineView {
  /** Producto suelto o kit. */
  type: LineType
  /** Nombre del producto o `Kit`. */
  name: string
  /** Opciones elegidas; vacío si no hay. */
  detail: string
  /** Unidades compradas. */
  quantity: number
  /** Precio de lista de una unidad. */
  unitPriceArs: number
  /** Ahorro por kit de la línea. */
  kitSavingsArs: number
  /** Importe de la línea. */
  totalArs: number
  /** Slug del producto al comprar, o `null` en un kit. */
  productSlug: string | null
  /** Cuero y virola de un mate o del kit, o `null`. */
  options: CartItemOptions | null
  /** Las tres piezas de un kit, o `null`. */
  kitItems: OrderKitItemView[] | null
}

/** Envío de un pedido (`OrderShipping` del contrato). */
export interface OrderShippingView {
  /** Método. */
  method: ShippingMethod
  /** Destino, o `null` en el retiro en persona. */
  address: ShippingAddress | null
  /** Costo al comprar. */
  costArs: number
  /** Plazo al comprar. */
  eta: string
}

/** Verificación 3-D Secure pendiente (`PaymentChallenge` del contrato). */
export interface PaymentChallengeView {
  /** Dirección de la verificación. */
  url: string
}

/** Pago de un pedido (`OrderPayment` del contrato): todo `null` salvo `method` hasta B5. */
export interface OrderPaymentView {
  /** Forma de pago. */
  method: PaymentMethod
  /** Cuotas, o `null`. */
  installments: number | null
  /** Tipo de medio de pago de Mercado Pago, o `null`. */
  paymentTypeId: string | null
  /** Últimos cuatro dígitos, o `null`. */
  lastFour: string | null
  /** Detalle del estado de Mercado Pago, o `null`. */
  statusDetail: string | null
  /** Id del pago en Mercado Pago, o `null`. */
  mpPaymentId: string | null
  /** Verificación pendiente, o `null`. */
  challenge: PaymentChallengeView | null
}

/** Despacho (`OrderTracking` del contrato). */
export interface OrderTrackingView {
  /** Empresa de transporte. */
  carrier: string
  /** Número de seguimiento. */
  number: string
}

/** Cambio de estado (`OrderHistoryEntry` del contrato). */
export interface OrderHistoryEntryView {
  /** Estado nuevo. */
  status: OrderStatus
  /** Momento, ISO 8601 en UTC. */
  at: string
  /** Nota, o `null`. */
  note: string | null
}

/** Pedido (`Order` del contrato). */
export interface OrderView {
  /** Número `GLP-` + cinco dígitos. */
  number: string
  /** Estado. */
  status: OrderStatus
  /** Estado del pago. */
  paymentStatus: PaymentStatus
  /** Contacto que escribió quien compró. */
  customer: CustomerView
  /** Envío. */
  shipping: OrderShippingView
  /** Líneas. */
  lines: OrderLineView[]
  /** Suma de los precios de lista. */
  itemsGrossArs: number
  /** Suma de los ahorros por kit. */
  kitSavingsArs: number
  /** Importe de las líneas sin envío. */
  subtotalArs: number
  /** Costo del envío. */
  shippingArs: number
  /** Total con el envío. */
  totalArs: number
  /** Pago. */
  payment: OrderPaymentView
  /** Despacho, o `null`. */
  tracking: OrderTrackingView | null
  /** Cambios de estado, del más viejo al más nuevo. */
  history: OrderHistoryEntryView[]
  /** Vencimiento de la reserva, ISO 8601 en UTC. */
  reservedUntil: string
  /** Creación, ISO 8601 en UTC. */
  createdAt: string
}

/** Pedido en el listado de "Mis pedidos" (`OrderSummary` del contrato). */
export interface OrderSummaryView {
  /** Número. */
  number: string
  /** Creación, ISO 8601 en UTC. */
  createdAt: string
  /** Estado. */
  status: OrderStatus
  /** Estado del pago. */
  paymentStatus: PaymentStatus
  /** Total con el envío. */
  totalArs: number
  /** Unidades: suma de las cantidades de las líneas (un kit cuenta como una). */
  itemCount: number
}

/** Página de "Mis pedidos" (`OrderSummaryPage` del contrato; la forma de `Page<OrderSummaryView>`). */
export interface OrderSummaryPageView {
  /** Pedidos de la página. */
  items: OrderSummaryView[]
  /** Número de página, desde 1. */
  page: number
  /** Pedidos por página (siempre 10). */
  pageSize: number
  /** Total de pedidos del cliente. */
  total: number
}

/** Pedido recién creado con su token (`CreateOrderResult` del contrato). */
export interface CreateOrderResultView {
  /** El pedido. */
  order: OrderView
  /** Token del pedido (`ot_` + 64 hex): se entrega solo en esta respuesta. */
  orderToken: string
}
