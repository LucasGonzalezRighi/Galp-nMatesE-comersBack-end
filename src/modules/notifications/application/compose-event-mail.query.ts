import type { MailTemplate, OutgoingMail } from '../../../shared/application/ports/mail.port'
import { CUSTOMER_REGISTERED_EVENT } from '../../identity/domain/identity-events'
import {
  ORDER_CANCELLED_EVENT,
  ORDER_CREATED_EVENT,
  ORDER_DELIVERED_EVENT,
  ORDER_EXPIRED_EVENT,
  ORDER_PAID_EVENT,
  ORDER_SHIPPED_EVENT,
} from '../../orders/domain/order-events'
import {
  CONTACT_RECEIVED_EVENT,
  WITHDRAWAL_REQUESTED_EVENT,
} from '../../support/domain/support-events'
import {
  accountCreatedMail,
  contactReceivedMail,
  withdrawalCodeMail,
} from '../domain/account-mails'
import type { RenderedMail, StoreInfo } from '../domain/mail-layout'
import {
  orderCancelledMail,
  orderDeliveredMail,
  orderReceivedMail,
  orderShippedMail,
  paymentApprovedMail,
} from '../domain/order-mails'
import type { MailDataReader } from './ports/mail-data.reader.port'

/** Plantilla que dispara cada evento del outbox (LS-6). */
export const MAIL_EVENT_TEMPLATES: Readonly<Record<string, MailTemplate>> = {
  [ORDER_CREATED_EVENT]: 'order-received',
  [ORDER_PAID_EVENT]: 'payment-approved',
  [ORDER_SHIPPED_EVENT]: 'order-shipped',
  [ORDER_DELIVERED_EVENT]: 'order-delivered',
  [ORDER_CANCELLED_EVENT]: 'order-cancelled',
  [ORDER_EXPIRED_EVENT]: 'order-cancelled',
  [WITHDRAWAL_REQUESTED_EVENT]: 'withdrawal-code',
  [CONTACT_RECEIVED_EVENT]: 'contact-received',
  [CUSTOMER_REGISTERED_EVENT]: 'account-created',
}

/**
 * Plantilla del mail de un evento.
 *
 * @param eventType - Tipo del evento del outbox.
 * @returns La plantilla, o `null` si el evento no manda mail.
 */
export function mailTemplateFor(eventType: string): MailTemplate | null {
  return Object.hasOwn(MAIL_EVENT_TEMPLATES, eventType)
    ? (MAIL_EVENT_TEMPLATES[eventType] ?? null)
    : null
}

/** Un evento del outbox que manda mail. */
export interface MailEvent {
  /** Tipo del evento (`order.created`…). */
  eventType: string
  /** Datos del evento (solo ids y, en `order.shipped`, el seguimiento). */
  payload: unknown
}

/**
 * Lee un campo de texto del payload de un evento.
 *
 * @throws {TypeError} En español, si falta o no es un texto.
 */
function payloadText(payload: unknown, key: string, eventType: string): string {
  const value =
    typeof payload === 'object' && payload !== null
      ? (payload as Record<string, unknown>)[key]
      : undefined
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`El evento ${eventType} no trae ${key}`)
  }
  return value
}

/**
 * Arma el mail de un evento del outbox, leyendo los datos al momento de mandar. El destinatario
 * es siempre el email del pedido, de la solicitud o de la cuenta, nunca otro.
 */
export class ComposeEventMailQuery {
  private readonly storeOrigin: string

  /**
   * @param reader - Lecturas de los mails.
   * @param storeOrigin - Origen de la tienda (`STORE_ORIGIN`).
   * @throws {TypeError} En español, si `storeOrigin` no es una URL http o https.
   */
  constructor(
    private readonly reader: MailDataReader,
    storeOrigin: string,
  ) {
    const origin = storeOrigin.trim().replace(/\/+$/, '')
    if (!/^https?:\/\/\S+$/.test(origin)) {
      throw new TypeError(
        `El origen de la tienda tiene que ser una URL http o https: "${storeOrigin}"`,
      )
    }
    this.storeOrigin = origin
  }

  /**
   * @param event - Tipo y payload del evento.
   * @returns El mail listo, o `null` si el evento no manda mail o el registro ya no existe.
   * @throws {TypeError} En español, si al payload le falta un id.
   */
  async execute(event: MailEvent): Promise<OutgoingMail | null> {
    const template = mailTemplateFor(event.eventType)
    if (template === null) return null
    const draft = await this.draft(template, event)
    if (draft === null) return null
    const store: StoreInfo = { storeOrigin: this.storeOrigin, ...(await this.reader.storeInfo()) }
    return { to: draft.to, template, ...draft.render(store) }
  }

  /** Lee los datos del evento y devuelve el destinatario y cómo armar el mail. */
  private async draft(
    template: MailTemplate,
    event: MailEvent,
  ): Promise<{ to: string; render: (store: StoreInfo) => RenderedMail } | null> {
    const { eventType, payload } = event
    switch (template) {
      case 'withdrawal-code': {
        const request = await this.reader.withdrawal(payloadText(payload, 'requestId', eventType))
        if (request === null) return null
        return { to: request.email, render: (store) => withdrawalCodeMail(request, store) }
      }
      case 'contact-received': {
        const email = await this.reader.contactEmail(payloadText(payload, 'messageId', eventType))
        if (email === null) return null
        return { to: email, render: (store) => contactReceivedMail(store) }
      }
      case 'account-created': {
        const account = await this.reader.account(payloadText(payload, 'customerId', eventType))
        if (account === null) return null
        return { to: account.email, render: (store) => accountCreatedMail(account, store) }
      }
      default:
        return this.orderDraft(template, event)
    }
  }

  /** Lo mismo que {@link draft} para los mails de un pedido. */
  private async orderDraft(
    template: MailTemplate,
    { eventType, payload }: MailEvent,
  ): Promise<{ to: string; render: (store: StoreInfo) => RenderedMail } | null> {
    const order = await this.reader.order(payloadText(payload, 'orderId', eventType))
    if (order === null) return null
    const base = { number: order.number, firstName: order.firstName }
    const render = (store: StoreInfo): RenderedMail => {
      switch (template) {
        case 'order-received':
          return orderReceivedMail(order, store)
        case 'payment-approved':
          return paymentApprovedMail({ ...base, totalArs: order.totalArs }, store)
        case 'order-shipped':
          return orderShippedMail(
            {
              ...base,
              carrier: payloadText(payload, 'carrier', eventType),
              trackingNumber: payloadText(payload, 'trackingNumber', eventType),
            },
            store,
          )
        case 'order-delivered':
          return orderDeliveredMail(base, store)
        default:
          return orderCancelledMail(
            { ...base, reason: eventType === ORDER_EXPIRED_EVENT ? 'expired' : 'cancelled' },
            store,
          )
      }
    }
    return { to: order.email, render }
  }
}
