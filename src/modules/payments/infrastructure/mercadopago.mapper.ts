import {
  MercadoPagoError,
  MPBadRequestError,
  type Payment as MpPayment,
  MPValidationError,
  type Preference,
} from 'mercadopago'

import { DomainError } from '../../../shared/domain/domain-error'
import type { OrderForPayment } from '../../orders/application/ports/order-payments.port'
import type {
  CardChargeInput,
  InstallmentsRequest,
  PreferenceInput,
} from '../application/ports/payment-gateway.port'
import { type InstallmentOption, parseInstallmentLabels } from '../domain/installments'
import { InvalidCardTokenError, PaymentGatewayError } from '../domain/payments-errors'
import type { ProviderPayment } from '../domain/provider-payment'

/** Cuerpo de `POST /checkout/preferences` (tipo del SDK). */
export type PreferenceBody = Parameters<Preference['create']>[0]['body']

/** Cuerpo de `POST /v1/payments` (tipo del SDK). */
export type PaymentBody = Parameters<MpPayment['create']>[0]['body']

/** Ítem de una preferencia o de `additional_info.items` (tipo del SDK). */
type MercadoPagoItem = PreferenceBody['items'][number]

/**
 * Lo que se lee de un pago de Mercado Pago (`POST /v1/payments`, `GET /v1/payments/{id}`,
 * `PUT …/{id}`). El `PaymentResponse` del SDK lo cumple; en JSON cualquier campo puede faltar.
 */
export interface MercadoPagoPaymentData {
  /** Id del pago (número). */
  id?: number | string | undefined
  /** `status` crudo. */
  status?: string | undefined
  /** `status_detail` crudo. */
  status_detail?: string | undefined
  /** Monto cobrado. */
  transaction_amount?: number | undefined
  /** Monto devuelto. */
  transaction_amount_refunded?: number | undefined
  /** Cuotas. */
  installments?: number | undefined
  /** Tipo de medio. */
  payment_type_id?: string | undefined
  /** Marca de la tarjeta. */
  payment_method_id?: string | undefined
  /** Banco emisor (la referencia dice string; llega también como número). */
  issuer_id?: string | number | undefined
  /** Número del pedido. */
  external_reference?: string | undefined
  /** Fecha de aprobación (ISO con offset). */
  date_approved?: string | undefined
  /** Tarjeta (solo se usan los últimos 4). */
  card?: { last_four_digits?: string | undefined } | undefined
  /** Desafío 3-D Secure, solo con `pending_challenge`. */
  three_ds_info?: { external_resource_url?: string | undefined } | undefined
}

/** Causas de un error del SDK que significan "el token de la tarjeta no sirve" (Ruling B-34). */
export const CARD_TOKEN_ERROR_CAUSES: readonly string[] = [
  '2006',
  '2062',
  '3003',
  '3006',
  '3008',
  '4000',
]

/** Moneda de todos los montos. */
const CURRENCY = 'ARS'

/** Argentina está en UTC−3 todo el año (sin horario de verano). */
const ARGENTINA_OFFSET_MS = 3 * 60 * 60_000

/** Medios offline que no cierran dentro de la reserva de 30 minutos (Ruling B-35). */
const EXCLUDED_PAYMENT_TYPES = [{ id: 'ticket' }, { id: 'atm' }]

/** Máximo de cuotas que ofrece Checkout Pro. */
const PREFERENCE_MAX_INSTALLMENTS = 12

/**
 * Fecha en el formato que piden las preferencias: hora de Argentina con milisegundos y offset,
 * `YYYY-MM-DDTHH:mm:ss.SSS-03:00`.
 *
 * @param date - Momento a escribir.
 * @returns La fecha formateada.
 * @throws {TypeError} En español, si la fecha no es válida.
 */
export function toMercadoPagoDate(date: Date): string {
  if (Number.isNaN(date.getTime())) {
    throw new TypeError('La fecha para Mercado Pago no es una fecha válida')
  }
  return new Date(date.getTime() - ARGENTINA_OFFSET_MS).toISOString().replace('Z', '-03:00')
}

/** `metadata` de la preferencia y del pago. */
function metadataOf(order: OrderForPayment): { orderId: string; number: string } {
  return { orderId: order.id, number: order.number }
}

/**
 * Un ítem por línea con `unit_price = totalArs / quantity`. Si el total de la línea no se divide
 * en pesos enteros (un descuento de kit, por ejemplo), va como un solo ítem con el total de la
 * línea: Mercado Pago cobra `unit_price × quantity` y no puede quedar ni un peso de diferencia.
 */
function lineItems(order: OrderForPayment): MercadoPagoItem[] {
  return order.lines.map((line) =>
    line.quantity > 0 && line.totalArs % line.quantity === 0
      ? {
          id: line.id,
          title: line.name,
          quantity: line.quantity,
          unit_price: line.totalArs / line.quantity,
          currency_id: CURRENCY,
        }
      : {
          id: line.id,
          title: `${line.name} ×${String(line.quantity)}`,
          quantity: 1,
          unit_price: line.totalArs,
          currency_id: CURRENCY,
        },
  )
}

/**
 * Ítems de la preferencia: las líneas y el envío (si cuesta algo). Si no suman exactamente el
 * total del pedido, se cobra el total en un único ítem: lo que manda es `order.totalArs`.
 */
function preferenceItems(order: OrderForPayment): MercadoPagoItem[] {
  const items = lineItems(order)
  if (order.shippingCostArs > 0) {
    items.push({
      id: 'envio',
      title: 'Envío',
      quantity: 1,
      unit_price: order.shippingCostArs,
      currency_id: CURRENCY,
    })
  }
  const sum = items.reduce((total, item) => total + item.unit_price * item.quantity, 0)
  if (sum === order.totalArs) return items
  return [
    {
      id: order.number,
      title: `Pedido ${order.number} · Galpón Mates`,
      quantity: 1,
      unit_price: order.totalArs,
      currency_id: CURRENCY,
    },
  ]
}

/**
 * Cuerpo de la preferencia de Checkout Pro (Ruling B-35).
 *
 * @param input - Pedido, URLs, vencimiento y descriptor.
 * @param now - Momento de creación (`expiration_date_from`).
 * @returns El cuerpo para `Preference.create`.
 */
export function toPreferenceBody(input: PreferenceInput, now: Date): PreferenceBody {
  const { order } = input
  return {
    items: preferenceItems(order),
    payer: {
      email: order.contact.email,
      name: order.contact.firstName,
      surname: order.contact.lastName,
    },
    external_reference: order.number,
    ...(input.notificationUrl === null ? {} : { notification_url: input.notificationUrl }),
    back_urls: { success: input.backUrl, pending: input.backUrl, failure: input.backUrl },
    auto_return: 'approved',
    expires: true,
    expiration_date_from: toMercadoPagoDate(now),
    expiration_date_to: toMercadoPagoDate(input.expiresAt),
    statement_descriptor: input.statementDescriptor,
    metadata: metadataOf(order),
    payment_methods: {
      excluded_payment_types: EXCLUDED_PAYMENT_TYPES.map((type) => ({ ...type })),
      installments: PREFERENCE_MAX_INSTALLMENTS,
    },
    binary_mode: false,
  }
}

/** Lo que se manda en el `PUT` que vence una preferencia. */
export interface ExpiredPreferenceBody {
  /** Siempre `true`. */
  expires: true
  /** Un minuto antes de ahora. */
  expiration_date_from: string
  /** Un segundo antes de ahora: la preferencia ya no admite pagos. */
  expiration_date_to: string
}

/**
 * Cuerpo del `PUT /checkout/preferences/{id}` que vence una preferencia: `expires: true` con
 * `expiration_date_to` en el pasado (Ruling B-44; Mercado Pago no tiene un `DELETE`).
 *
 * @param now - Momento actual.
 * @returns Los campos a cambiar.
 */
export function toExpiredPreferenceBody(now: Date): ExpiredPreferenceBody {
  return {
    expires: true,
    expiration_date_from: toMercadoPagoDate(new Date(now.getTime() - 60_000)),
    expiration_date_to: toMercadoPagoDate(new Date(now.getTime() - 1_000)),
  }
}

/**
 * Cuerpo del pago con tarjeta de Checkout API (Ruling B-35): el total del pedido, captura
 * automática, sin modo binario y 3-D Secure opcional (el desafío necesita `binary_mode: false`).
 *
 * @param input - Pedido, token, cuotas y pagador.
 * @returns El cuerpo para `Payment.create`.
 */
export function toPaymentBody(input: CardChargeInput): PaymentBody {
  const { order } = input
  const issuerId = input.issuerId === null ? Number.NaN : Number(input.issuerId)
  return {
    token: input.token,
    transaction_amount: order.totalArs,
    installments: input.installments,
    payment_method_id: input.paymentMethodId,
    ...(Number.isSafeInteger(issuerId) ? { issuer_id: issuerId } : {}),
    payer: {
      email: input.payer.email,
      identification: {
        type: input.payer.identification.type,
        number: input.payer.identification.number,
      },
    },
    description: `Pedido ${order.number} · Galpón Mates`,
    external_reference: order.number,
    ...(input.notificationUrl === null ? {} : { notification_url: input.notificationUrl }),
    metadata: metadataOf(order),
    statement_descriptor: input.statementDescriptor,
    capture: true,
    binary_mode: false,
    three_d_secure_mode: 'optional',
    additional_info: { items: lineItems(order) },
  }
}

/** Monto de Mercado Pago (puede traer centavos) en pesos enteros. */
function pesos(value: number | undefined): number {
  return value === undefined || !Number.isFinite(value) ? 0 : Math.round(value)
}

/** Fecha ISO de Mercado Pago, o `null` si falta o no es válida. */
function dateOrNull(value: string | undefined): Date | null {
  if (value === undefined || value === '') return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

/** Texto no vacío o `null`. */
function textOrNull(value: string | number | undefined | null): string | null {
  if (value === undefined || value === null) return null
  const text = String(value)
  return text === '' ? null : text
}

/**
 * Traduce un pago de Mercado Pago al {@link ProviderPayment} del dominio. Los montos se
 * redondean a pesos enteros (las columnas son enteras).
 *
 * @param response - Pago tal como lo devuelve la API.
 * @returns El pago normalizado.
 * @throws {PaymentGatewayError} Si la respuesta no trae el id del pago.
 */
export function toProviderPayment(response: MercadoPagoPaymentData): ProviderPayment {
  const providerPaymentId = textOrNull(response.id)
  if (providerPaymentId === null) throw new PaymentGatewayError()
  return {
    providerPaymentId,
    status: response.status ?? '',
    statusDetail: textOrNull(response.status_detail),
    amountArs: pesos(response.transaction_amount),
    refundedArs: pesos(response.transaction_amount_refunded),
    installments: response.installments ?? null,
    paymentTypeId: textOrNull(response.payment_type_id),
    paymentMethodId: textOrNull(response.payment_method_id),
    cardLastFour: textOrNull(response.card?.last_four_digits),
    issuerId: textOrNull(response.issuer_id),
    externalReference: textOrNull(response.external_reference),
    challengeUrl: textOrNull(response.three_ds_info?.external_resource_url),
    approvedAt: dateOrNull(response.date_approved),
  }
}

/** Un `payer_costs[]` de `GET /v1/payment_methods/installments`. */
interface MercadoPagoPayerCost {
  installments: number
  installment_amount: number
  total_amount: number
  labels: string[]
  recommended_message: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Lee un `payer_costs[]`, o `null` si le faltan los números. */
function toPayerCost(value: unknown): MercadoPagoPayerCost | null {
  if (!isRecord(value)) return null
  const { installments, installment_amount, total_amount, labels, recommended_message } = value
  if (
    typeof installments !== 'number' ||
    typeof installment_amount !== 'number' ||
    typeof total_amount !== 'number'
  ) {
    return null
  }
  return {
    installments,
    installment_amount,
    total_amount,
    labels: Array.isArray(labels)
      ? labels.filter((label): label is string => typeof label === 'string')
      : [],
    recommended_message: typeof recommended_message === 'string' ? recommended_message : null,
  }
}

/**
 * Traduce la respuesta de `GET /v1/payment_methods/installments` (Ruling B-50): las opciones del
 * primer medio, cada una con cuota y total redondeados, el CFT y la TEA de `labels` (0 si no
 * están) y `recommended_message` como texto. Con débito queda solo la de 1 pago.
 *
 * @param body - JSON de la respuesta (un array).
 * @param paymentTypeId - Crédito o débito.
 * @returns Las opciones, de menos a más cuotas (vacío si Mercado Pago no tiene ninguna).
 * @throws {PaymentGatewayError} Si la respuesta no tiene la forma esperada.
 */
export function toInstallmentOptions(
  body: unknown,
  paymentTypeId: InstallmentsRequest['paymentTypeId'],
): InstallmentOption[] {
  if (!Array.isArray(body)) throw new PaymentGatewayError()
  const methods: readonly unknown[] = body
  const first = methods[0]
  if (first === undefined) return []
  if (!isRecord(first) || !Array.isArray(first.payer_costs)) throw new PaymentGatewayError()
  return first.payer_costs
    .map(toPayerCost)
    .filter((cost): cost is MercadoPagoPayerCost => cost !== null)
    .filter((cost) => paymentTypeId === 'credit_card' || cost.installments === 1)
    .sort((a, b) => a.installments - b.installments)
    .map((cost) => {
      const installmentAmountArs = Math.round(cost.installment_amount)
      return {
        installments: cost.installments,
        installmentAmountArs,
        totalArs: Math.round(cost.total_amount),
        ...parseInstallmentLabels(cost.labels),
        label:
          cost.recommended_message ??
          `${String(cost.installments)} × $ ${String(installmentAmountArs)}`,
      }
    })
}

/** Códigos de las causas de un error del SDK, como texto. */
function causeCodes(error: MercadoPagoError): string[] {
  return error.causes.flatMap((cause) =>
    isRecord(cause) && (typeof cause.code === 'number' || typeof cause.code === 'string')
      ? [String(cause.code)]
      : [],
  )
}

/**
 * Indica si un error del SDK es por el token de la tarjeta (400 o 422 con una causa de
 * {@link CARD_TOKEN_ERROR_CAUSES}).
 *
 * @param error - Lo que se atrapó.
 * @returns `true` si el token no sirve.
 */
export function isCardTokenError(error: unknown): boolean {
  if (!(error instanceof MPBadRequestError || error instanceof MPValidationError)) return false
  return causeCodes(error).some((code) => CARD_TOKEN_ERROR_CAUSES.includes(code))
}

/**
 * Traduce un error de la pasarela al error del dominio: token inválido → `InvalidCardTokenError`
 * (422); cualquier otro error de Mercado Pago, de red o inesperado → `PaymentGatewayError` (502).
 * Un error del dominio ya traducido pasa tal cual.
 *
 * @param error - Lo que se atrapó.
 * @returns El error a lanzar.
 */
export function toGatewayError(error: unknown): Error {
  if (error instanceof DomainError) return error
  if (isCardTokenError(error)) return new InvalidCardTokenError()
  return new PaymentGatewayError()
}

/**
 * Texto de un error para el log: de un error del SDK, solo `status`, `error` y las causas
 * (`code: description`); nunca el cuerpo de la respuesta ni el token. De otro error, su mensaje.
 *
 * @param error - Lo que se atrapó.
 * @returns El texto.
 */
export function describeMercadoPagoError(error: unknown): string {
  if (!(error instanceof MercadoPagoError)) {
    return error instanceof Error ? error.message : String(error)
  }
  const causes = error.causes.flatMap((cause) => {
    if (!isRecord(cause)) return []
    const { code, description } = cause
    const codeText = typeof code === 'number' || typeof code === 'string' ? String(code) : '?'
    return [`${codeText}: ${typeof description === 'string' ? description : ''}`]
  })
  return `status ${String(error.status)}, error ${error.error}, causas [${causes.join('; ')}]`
}
