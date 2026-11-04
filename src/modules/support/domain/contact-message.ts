/** Tipos de mensaje de la bandeja (`ContactMessageKind` del contrato). */
export const CONTACT_MESSAGE_KINDS = ['contact', 'withdrawal'] as const

/** `contact` es del formulario de contacto y `withdrawal`, una solicitud de arrepentimiento. */
export type ContactMessageKind = (typeof CONTACT_MESSAGE_KINDS)[number]

/** Motivos del formulario de contacto, con su texto exacto (`ContactReason` del contrato). */
export const CONTACT_REASONS = ['Pedido', 'Envío', 'Cambio', 'Arrepentimiento', 'Otro'] as const

/** Uno de los motivos de {@link CONTACT_REASONS}. */
export type ContactReason = (typeof CONTACT_REASONS)[number]

/** Prefijo del código de comprobante de un arrepentimiento. */
export const WITHDRAWAL_CODE_PREFIX = 'ARR-'

/** Cantidad de dígitos del número del código de comprobante (como el mock del front). */
export const WITHDRAWAL_CODE_DIGITS = 6

/** Mayor número de comprobante (`withdrawal_code_seq` no pasa de acá). */
export const WITHDRAWAL_CODE_MAX = 999_999

/** Mensaje de la bandeja del dashboard, del formulario de contacto o de un arrepentimiento. */
export interface ContactMessage {
  /** Id del mensaje. */
  id: string
  /** Tipo de mensaje. */
  kind: ContactMessageKind
  /** Nombre de quien escribió. */
  name: string
  /** Email, recortado y en minúsculas. */
  email: string
  /** Número del pedido del que se trata, o `null`. */
  orderNumber: string | null
  /** Motivo del contacto, o `null` en un arrepentimiento. */
  reason: ContactReason | null
  /** Texto del mensaje, o `null` si es un arrepentimiento sin comentario. */
  message: string | null
  /** Código de comprobante de un arrepentimiento, o `null` en un contacto. */
  code: string | null
  /** Cuándo llegó. */
  createdAt: Date
  /** Cuándo se marcó como leído, o `null` si no está leído. */
  readAt: Date | null
}

/** Mensaje nuevo, antes de guardarlo (el id y las fechas los pone la base). */
export type NewContactMessage = Omit<ContactMessage, 'id' | 'createdAt' | 'readAt'>

/**
 * Arma el código de comprobante de un arrepentimiento: `ARR-` y el número con 6 dígitos.
 *
 * @param n - Número de la secuencia, entero de 1 a 999.999.
 * @returns El código, por ejemplo `ARR-000001`.
 * @throws {RangeError} En español, si el número no es un entero de 1 a 999.999.
 * @example
 * formatWithdrawalCode(31) // 'ARR-000031'
 */
export function formatWithdrawalCode(n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > WITHDRAWAL_CODE_MAX) {
    throw new RangeError(
      `El número de comprobante tiene que ser un entero de 1 a ${String(WITHDRAWAL_CODE_MAX)}; se recibió ${String(n)}.`,
    )
  }
  return `${WITHDRAWAL_CODE_PREFIX}${String(n).padStart(WITHDRAWAL_CODE_DIGITS, '0')}`
}

/**
 * Indica si el campo trampa (`website`) vino lleno: cualquier texto que no sea vacío, un espacio
 * también (como el mock). Las personas no lo ven y lo dejan en `null` o `''`.
 *
 * @param website - Valor del campo trampa.
 * @returns `true` si lo llenó un bot.
 */
export function isHoneypotFilled(website: string | null): boolean {
  return website !== null && website !== ''
}

/**
 * Revisa un mensaje nuevo: un contacto lleva motivo y texto y no tiene código; un arrepentimiento
 * lleva su código y no tiene motivo (lo mismo que el `CHECK` de `contact_messages`).
 *
 * @param message - Mensaje a guardar.
 * @returns El mismo mensaje, ya revisado.
 * @throws {TypeError} En español, si falta el nombre o el email, o si los campos no corresponden
 *   a su tipo.
 */
export function createContactMessage(message: NewContactMessage): NewContactMessage {
  if (message.name.trim() === '' || message.email.trim() === '') {
    throw new TypeError('Un mensaje de la bandeja necesita el nombre y el email de quien escribe.')
  }
  if (message.kind === 'contact') {
    if (message.reason === null || message.message === null || message.code !== null) {
      throw new TypeError('Un mensaje de contacto lleva motivo y texto, y no tiene código.')
    }
  } else if (message.reason !== null || message.code?.startsWith(WITHDRAWAL_CODE_PREFIX) !== true) {
    throw new TypeError('Un arrepentimiento lleva su código ARR- y no tiene motivo.')
  }
  return message
}
