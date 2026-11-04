import type {
  ContactMessageFilter,
  ContactMessageRepository,
} from '../ports/contact-message.repository.port'
import { type ContactMessagePage, toContactMessageView } from '../read-models'

/** Mensajes por página en la bandeja (fijo, como el mock del front). */
export const ADMIN_MESSAGES_PAGE_SIZE = 20

/** Bandeja del dashboard: del más nuevo al más viejo, de a 20, filtrada por tipo y leído. */
export class ListAdminMessagesQuery {
  /** @param messages - Bandeja. */
  constructor(private readonly messages: Pick<ContactMessageRepository, 'list'>) {}

  /**
   * @param filter - Tipo y leído (los que no vienen no filtran).
   * @param page - Página, desde 1 (fuera de rango: `items` vacío con el total real).
   * @returns La página con la forma `ContactMessagePage` del contrato.
   * @throws {RangeError} En español, si la página no es un entero mayor o igual a 1.
   */
  async execute(filter: ContactMessageFilter, page: number): Promise<ContactMessagePage> {
    if (!Number.isSafeInteger(page) || page < 1) {
      throw new RangeError(`La página tiene que ser un entero desde 1; se recibió ${String(page)}.`)
    }
    const { items, total } = await this.messages.list(filter, page, ADMIN_MESSAGES_PAGE_SIZE)
    return {
      items: items.map(toContactMessageView),
      page,
      pageSize: ADMIN_MESSAGES_PAGE_SIZE,
      total,
    }
  }
}
