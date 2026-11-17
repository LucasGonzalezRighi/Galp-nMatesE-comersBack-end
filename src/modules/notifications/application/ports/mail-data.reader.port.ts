import type { StoreInfo } from '../../domain/mail-layout'
import type { OrderMailLine } from '../../domain/order-mails'

/** Lo que hace falta de un pedido para sus mails. */
export interface OrderMailRecord {
  /** Número (`GLP-10001`). */
  number: string
  /** Email del pedido (al que van todos sus mails). */
  email: string
  /** Nombre de quien compró. */
  firstName: string
  /** Líneas, en orden. */
  lines: OrderMailLine[]
  /** Costo del envío en pesos enteros. */
  shippingCostArs: number
  /** Total en pesos enteros. */
  totalArs: number
  /** Hasta cuándo se guarda el stock sin pago. */
  reservedUntil: Date
}

/** Lo que hace falta de una solicitud de arrepentimiento para su mail. */
export interface WithdrawalMailRecord {
  /** Email de la solicitud. */
  email: string
  /** Código (`ARR-000123`). */
  code: string
  /** Número de pedido que se informó, o `null`. */
  orderNumber: string | null
}

/** Destinatario de un mail de la cuenta. */
export interface AccountMailRecord {
  /** Email de la cuenta. */
  email: string
  /** Nombre. */
  firstName: string
}

/**
 * Lecturas de los mails: el handler del outbox guarda solo ids y los datos se leen al mandar (así
 * un mail nunca lleva datos viejos ni los guarda en la cola). Cada lectura devuelve `null` si el
 * registro ya no existe (por ejemplo, una cuenta eliminada): ese mail no sale.
 */
export interface MailDataReader {
  /**
   * @param orderId - Id del pedido.
   * @returns Los datos del pedido, o `null` si no existe.
   */
  order(orderId: string): Promise<OrderMailRecord | null>

  /**
   * @param messageId - Id del mensaje de la bandeja de tipo `withdrawal`.
   * @returns La solicitud, o `null` si no existe o no es un arrepentimiento.
   */
  withdrawal(messageId: string): Promise<WithdrawalMailRecord | null>

  /**
   * @param messageId - Id del mensaje de la bandeja de tipo `contact`.
   * @returns El email de quien escribió, o `null` si no existe o no es un contacto.
   */
  contactEmail(messageId: string): Promise<string | null>

  /**
   * @param customerId - Id del cliente con cuenta.
   * @returns Email y nombre, o `null` si no existe o no tiene cuenta.
   */
  account(customerId: string): Promise<AccountMailRecord | null>

  /** @returns Email de contacto y datos del vendedor, de los ajustes. */
  storeInfo(): Promise<Omit<StoreInfo, 'storeOrigin'>>
}

/** Token de inyección del {@link MailDataReader}. */
export const MAIL_DATA_READER = Symbol('MAIL_DATA_READER')
