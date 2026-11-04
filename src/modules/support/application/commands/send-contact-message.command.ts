import { isHoneypotFilled } from '../../../../shared/domain/honeypot'
import { type ContactReason, createContactMessage } from '../../domain/contact-message'
import type { ContactMessageRepository } from '../ports/contact-message.repository.port'
import { SILENT_SUPPORT_MAIL_LOG, type SupportMailLog } from '../ports/support-mail-log.port'

/** Mensaje del formulario de contacto, ya validado y normalizado (`ContactInput`). */
export interface ContactInput {
  /** Nombre, recortado. */
  name: string
  /** Email, recortado y en minúsculas. */
  email: string
  /** Número de pedido en mayúsculas, o `null`. */
  orderNumber: string | null
  /** Motivo. */
  reason: ContactReason
  /** Texto, recortado. */
  message: string
  /** Campo trampa: `null` o `''` para las personas. */
  website: string | null
}

/**
 * Deja el mensaje del formulario de contacto en la bandeja del dashboard. Con el campo trampa
 * lleno no guarda nada y responde igual (el bot no se entera). El mail a la tienda llega en B7:
 * por ahora queda la intención en el log, sin datos personales.
 */
export class SendContactMessageCommand {
  /**
   * @param messages - Bandeja.
   * @param mailLog - Registro de los mails que todavía no salen.
   */
  constructor(
    private readonly messages: Pick<ContactMessageRepository, 'create'>,
    private readonly mailLog: SupportMailLog = SILENT_SUPPORT_MAIL_LOG,
  ) {}

  /**
   * Guarda el mensaje, salvo que el campo trampa venga lleno.
   *
   * @param input - Mensaje ya validado.
   * @throws {TypeError} En español, si falta el nombre o el email.
   */
  async execute(input: ContactInput): Promise<void> {
    if (isHoneypotFilled(input.website)) return
    await this.messages.create(
      createContactMessage({
        kind: 'contact',
        name: input.name,
        email: input.email,
        orderNumber: input.orderNumber,
        reason: input.reason,
        message: input.message,
        code: null,
      }),
    )
    this.mailLog.log('Mensaje de contacto nuevo en la bandeja: el aviso por mail llega en B7.')
  }
}
