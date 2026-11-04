import type {
  ContactMessage,
  ContactMessageKind,
  NewContactMessage,
} from '../../domain/contact-message'

/** Filtros de la bandeja: los que no vienen no filtran. */
export interface ContactMessageFilter {
  /** Solo los de ese tipo. */
  kind?: ContactMessageKind | undefined
  /** `true`: solo los leídos; `false`: solo los no leídos. */
  read?: boolean | undefined
}

/** Página de mensajes, del más nuevo al más viejo. */
export interface ContactMessageSlice {
  /** Mensajes de la página. */
  items: ContactMessage[]
  /** Total de mensajes que cumplen los filtros. */
  total: number
}

/** Bandeja del dashboard: mensajes de contacto y solicitudes de arrepentimiento. */
export interface ContactMessageRepository {
  /**
   * Toma el próximo número de comprobante de arrepentimiento (`withdrawal_code_seq`). Nunca se
   * repite, aunque el arrepentimiento no se guarde.
   *
   * @returns Un entero de 1 a 999.999.
   */
  nextWithdrawalNumber(): Promise<number>

  /**
   * Guarda un mensaje nuevo, sin leer.
   *
   * @param message - Mensaje ya revisado.
   */
  create(message: NewContactMessage): Promise<void>

  /**
   * Una página de la bandeja, del más nuevo al más viejo.
   *
   * @param filter - Tipo y leído.
   * @param page - Página, desde 1.
   * @param pageSize - Mensajes por página.
   */
  list(filter: ContactMessageFilter, page: number, pageSize: number): Promise<ContactMessageSlice>

  /**
   * Marca un mensaje como leído o no leído. Marcarlo leído cuando ya lo estaba conserva la fecha
   * del primero; no leído la borra.
   *
   * @param id - Id del mensaje (uno que no es un UUID no existe).
   * @param read - Si queda leído.
   * @param now - Fecha de lectura si recién se lee.
   * @returns El mensaje como quedó, o `null` si no existe.
   */
  setRead(id: string, read: boolean, now: Date): Promise<ContactMessage | null>
}

/** Token de inyección del {@link ContactMessageRepository}. */
export const CONTACT_MESSAGE_REPOSITORY = Symbol('CONTACT_MESSAGE_REPOSITORY')
