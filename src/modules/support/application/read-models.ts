// Formas de lectura de la bandeja: copian `components/schemas` del contrato
// (`../frontend/docs/api/openapi.yaml`).

import type { ContactMessage, ContactMessageKind, ContactReason } from '../domain/contact-message'

/** Mensaje de la bandeja (`ContactMessage`). */
export interface ContactMessageView {
  /** Id del mensaje. */
  id: string
  /** Tipo de mensaje. */
  kind: ContactMessageKind
  /** Nombre de quien escribió. */
  name: string
  /** Email. */
  email: string
  /** Número de pedido, o `null`. */
  orderNumber: string | null
  /** Motivo del contacto, o `null` en un arrepentimiento. */
  reason: ContactReason | null
  /** Texto, o `null` en un arrepentimiento sin comentario. */
  message: string | null
  /** Código de comprobante, o `null` en un contacto. */
  code: string | null
  /** Cuándo llegó, ISO 8601 en UTC. */
  createdAt: string
  /** Si ya se leyó. */
  read: boolean
}

/** Comprobante de un arrepentimiento (`WithdrawalReceipt`). */
export interface WithdrawalReceipt {
  /** Código de comprobante, `ARR-` y 6 dígitos. */
  code: string
}

/**
 * Pasa un mensaje del dominio a la forma del contrato.
 *
 * @param message - Mensaje de la bandeja.
 * @returns El mensaje con la fecha en ISO 8601 y `read` según `readAt`.
 */
export function toContactMessageView(message: ContactMessage): ContactMessageView {
  return {
    id: message.id,
    kind: message.kind,
    name: message.name,
    email: message.email,
    orderNumber: message.orderNumber,
    reason: message.reason,
    message: message.message,
    code: message.code,
    createdAt: message.createdAt.toISOString(),
    read: message.readAt !== null,
  }
}

/** Página de la bandeja (`ContactMessagePage`). */
export interface ContactMessagePage {
  /** Mensajes de la página, del más nuevo al más viejo. */
  items: ContactMessageView[]
  /** Número de página, desde 1. */
  page: number
  /** Mensajes por página (20). */
  pageSize: number
  /** Total de mensajes que cumplen los filtros. */
  total: number
}
