import { formatPesos } from '../../../shared/domain/format-pesos'
import {
  formatMailDateTime,
  greetingFor,
  legalLinks,
  type MailBlock,
  type RenderedMail,
  renderMail,
  requireMailText,
  type StoreInfo,
  storeUrl,
} from './mail-layout'

/** Días corridos del derecho de arrepentimiento (LDC 34, CCyC 1110). */
export const WITHDRAWAL_DAYS = 10

/** Días corridos para pedir un cambio (LS-1). */
export const EXCHANGE_DAYS = 30

/** Línea del pedido en el resumen del mail. */
export interface OrderMailLine {
  /** Nombre del producto, kit o combo. */
  name: string
  /** Detalle (cuero, virola…), o vacío. */
  detail: string
  /** Unidades. */
  quantity: number
  /** Total de la línea en pesos enteros. */
  totalArs: number
}

/** Datos comunes de los mails de un pedido. */
export interface OrderMailBase {
  /** Número del pedido (`GLP-10001`). */
  number: string
  /** Nombre de quien compró, o `null` para un saludo sin nombre. */
  firstName: string | null
}

/** Datos del mail `order-received`. */
export interface OrderReceivedInput extends OrderMailBase {
  /** Líneas del pedido. */
  lines: OrderMailLine[]
  /** Costo del envío en pesos enteros (0 si no tiene). */
  shippingCostArs: number
  /** Total en pesos enteros. */
  totalArs: number
  /** Hasta cuándo se guarda el stock sin pago. */
  reservedUntil: Date
}

/** Datos del mail `payment-approved`. */
export interface PaymentApprovedInput extends OrderMailBase {
  /** Total pagado en pesos enteros. */
  totalArs: number
}

/** Datos del mail `order-shipped`. */
export interface OrderShippedInput extends OrderMailBase {
  /** Empresa de envío. */
  carrier: string
  /** Número de seguimiento. */
  trackingNumber: string
}

/** Por qué se canceló un pedido: venció la reserva sin pago o lo canceló la tienda. */
export type OrderCancelReason = 'expired' | 'cancelled'

/** Datos del mail `order-cancelled`. */
export interface OrderCancelledInput extends OrderMailBase {
  /** Motivo. */
  reason: OrderCancelReason
}

/** Número del pedido revisado. */
function orderNumberOf(input: OrderMailBase): string {
  return requireMailText(input.number, 'el número de pedido')
}

/** Párrafo y enlace del Botón de Arrepentimiento. */
function withdrawalBlocks(store: StoreInfo, since: string): MailBlock[] {
  return [
    {
      kind: 'paragraph',
      text: `Tenés ${String(WITHDRAWAL_DAYS)} días corridos ${since} para arrepentirte de la compra, sin costo y sin dar explicaciones: el envío de vuelta lo pagamos nosotros y te devolvemos lo que pagaste.`,
    },
    {
      kind: 'link',
      label: 'Botón de Arrepentimiento',
      url: storeUrl(store, '/arrepentimiento'),
    },
  ]
}

/** Renglón de una línea del pedido: `2 × Mate (Cuero negro): $40.000`. */
function lineText(line: OrderMailLine): string {
  if (!Number.isInteger(line.quantity) || line.quantity < 1) {
    throw new RangeError(`Las unidades de una línea del mail tienen que ser un entero positivo`)
  }
  const name = requireMailText(line.name, 'el nombre de cada línea')
  const detail = line.detail.trim()
  return `${String(line.quantity)} × ${name}${detail === '' ? '' : ` (${detail})`}: ${formatPesos(line.totalArs)}`
}

/**
 * Mail `order-received` (evento `order.created`): la confirmación del pedido que exige el CCyC
 * 1108, con el resumen, el total, el pago pendiente y hasta cuándo se reserva, el derecho de
 * arrepentimiento y los enlaces a los términos y a las devoluciones.
 *
 * @param input - Datos del pedido.
 * @param store - Datos de la tienda.
 * @returns El mail armado.
 * @throws {TypeError} En español, si falta el número o el nombre de una línea.
 * @throws {RangeError} En español, si un monto o unas unidades no son válidos.
 */
export function orderReceivedMail(input: OrderReceivedInput, store: StoreInfo): RenderedMail {
  const number = orderNumberOf(input)
  return renderMail(
    {
      subject: `Recibimos tu pedido ${number}`,
      greeting: greetingFor(input.firstName),
      blocks: [
        { kind: 'paragraph', text: `Recibimos tu pedido ${number}. Este es el resumen:` },
        { kind: 'list', items: input.lines.map(lineText) },
        {
          kind: 'paragraph',
          text: `Envío: ${formatPesos(input.shippingCostArs)}. Total: ${formatPesos(input.totalArs)}.`,
        },
        {
          kind: 'paragraph',
          text: `El pedido está pendiente de pago con Mercado Pago: te guardamos el stock hasta el ${formatMailDateTime(input.reservedUntil)} (hora de Argentina). Si no se paga para entonces, se cancela solo.`,
        },
        ...withdrawalBlocks(store, 'desde que lo recibís'),
        ...legalLinks(store),
      ],
    },
    store,
  )
}

/**
 * Mail `payment-approved` (evento `order.paid`).
 *
 * @param input - Número, nombre y total.
 * @param store - Datos de la tienda.
 * @returns El mail armado.
 * @throws {TypeError} En español, si falta el número.
 * @throws {RangeError} En español, si el total no es válido.
 */
export function paymentApprovedMail(input: PaymentApprovedInput, store: StoreInfo): RenderedMail {
  const number = orderNumberOf(input)
  return renderMail(
    {
      subject: `Aprobamos el pago de tu pedido ${number}`,
      greeting: greetingFor(input.firstName),
      blocks: [
        {
          kind: 'paragraph',
          text: `Mercado Pago aprobó el pago de ${formatPesos(input.totalArs)} de tu pedido ${number}. Ya lo estamos preparando y te avisamos cuando lo despachemos.`,
        },
        ...withdrawalBlocks(store, 'desde que lo recibís'),
        ...legalLinks(store),
      ],
    },
    store,
  )
}

/**
 * Mail `order-shipped` (evento `order.shipped`), con la empresa y el número de seguimiento.
 *
 * @param input - Número, nombre, empresa y seguimiento.
 * @param store - Datos de la tienda.
 * @returns El mail armado.
 * @throws {TypeError} En español, si falta el número, la empresa o el seguimiento.
 */
export function orderShippedMail(input: OrderShippedInput, store: StoreInfo): RenderedMail {
  const number = orderNumberOf(input)
  const carrier = requireMailText(input.carrier, 'la empresa de envío')
  const tracking = requireMailText(input.trackingNumber, 'el número de seguimiento')
  return renderMail(
    {
      subject: `Despachamos tu pedido ${number}`,
      greeting: greetingFor(input.firstName),
      blocks: [
        { kind: 'paragraph', text: `Tu pedido ${number} ya está en camino.` },
        { kind: 'list', items: [`Empresa: ${carrier}`, `Número de seguimiento: ${tracking}`] },
        ...legalLinks(store),
      ],
    },
    store,
  )
}

/**
 * Mail `order-delivered` (evento `order.delivered`): recuerda el arrepentimiento, los cambios y la
 * garantía legal.
 *
 * @param input - Número y nombre.
 * @param store - Datos de la tienda.
 * @returns El mail armado.
 * @throws {TypeError} En español, si falta el número.
 */
export function orderDeliveredMail(input: OrderMailBase, store: StoreInfo): RenderedMail {
  const number = orderNumberOf(input)
  return renderMail(
    {
      subject: `Entregamos tu pedido ${number}`,
      greeting: greetingFor(input.firstName),
      blocks: [
        {
          kind: 'paragraph',
          text: `Tu pedido ${number} figura como entregado. ¡Que lo disfrutes!`,
        },
        ...withdrawalBlocks(store, 'desde hoy'),
        {
          kind: 'paragraph',
          text: `Para un cambio tenés ${String(EXCHANGE_DAYS)} días corridos, y la garantía legal es de 6 meses.`,
        },
        ...legalLinks(store),
      ],
    },
    store,
  )
}

/** Motivo de la cancelación, en una línea. */
const CANCEL_REASON_TEXT: Record<OrderCancelReason, string> = {
  expired: 'venció el plazo para pagarlo y liberamos el stock reservado.',
  cancelled:
    'lo canceló la tienda. Si ya lo habías pagado, te devolvemos el dinero por el mismo medio de pago.',
}

/**
 * Mail `order-cancelled` (eventos `order.cancelled` y `order.expired`), con el motivo en una
 * línea.
 *
 * @param input - Número, nombre y motivo.
 * @param store - Datos de la tienda.
 * @returns El mail armado.
 * @throws {TypeError} En español, si falta el número o el motivo no es válido.
 */
export function orderCancelledMail(input: OrderCancelledInput, store: StoreInfo): RenderedMail {
  const number = orderNumberOf(input)
  if (!Object.hasOwn(CANCEL_REASON_TEXT, input.reason)) {
    throw new TypeError(`El motivo de la cancelación tiene que ser expired o cancelled`)
  }
  return renderMail(
    {
      subject: `Tu pedido ${number} quedó cancelado`,
      greeting: greetingFor(input.firstName),
      blocks: [
        { kind: 'paragraph', text: `Tu pedido ${number} quedó cancelado.` },
        { kind: 'paragraph', text: `Motivo: ${CANCEL_REASON_TEXT[input.reason]}` },
        {
          kind: 'paragraph',
          text: `Si tenés alguna duda, escribinos a ${store.contactEmail}.`,
        },
      ],
    },
    store,
  )
}
