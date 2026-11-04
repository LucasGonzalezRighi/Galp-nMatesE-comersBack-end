import type { Clock } from '../../../../shared/domain/clock'
import { MessageNotFoundError } from '../../domain/support-errors'
import type { ContactMessageRepository } from '../ports/contact-message.repository.port'
import { type ContactMessageView, toContactMessageView } from '../read-models'

/**
 * Marca un mensaje de la bandeja como leído o no leído. Leído otra vez conserva la fecha del
 * primero; no leído la borra. Los no leídos cuentan en `unreadMessages` del resumen.
 */
export class MarkMessageCommand {
  /**
   * @param messages - Bandeja.
   * @param clock - Reloj (fecha de lectura).
   */
  constructor(
    private readonly messages: Pick<ContactMessageRepository, 'setRead'>,
    private readonly clock: Clock,
  ) {}

  /**
   * @param id - Id del mensaje, tal como llegó en la ruta.
   * @param read - Si queda leído.
   * @returns El mensaje como quedó.
   * @throws {MessageNotFoundError} Si no existe (o el id no es un UUID): 404.
   */
  async execute(id: string, read: boolean): Promise<ContactMessageView> {
    const message = await this.messages.setRead(id, read, this.clock.now())
    if (message === null) throw new MessageNotFoundError()
    return toContactMessageView(message)
  }
}
