import {
  createContactMessage,
  formatWithdrawalCode,
  isHoneypotFilled,
} from '../../domain/contact-message'
import type { ContactMessageRepository } from '../ports/contact-message.repository.port'
import { SILENT_SUPPORT_MAIL_LOG, type SupportMailLog } from '../ports/support-mail-log.port'
import type { WithdrawalReceipt } from '../read-models'

/** Solicitud de arrepentimiento, ya validada y normalizada (`WithdrawalInput`). */
export interface WithdrawalInput {
  /** Nombre, recortado. */
  name: string
  /** Email, recortado y en minúsculas. */
  email: string
  /** Número de pedido en mayúsculas, o `null`. */
  orderNumber: string | null
  /** Comentario recortado, o `null`. */
  comment: string | null
  /** Campo trampa: `null` o `''` para las personas. */
  website: string | null
}

/**
 * Registra una solicitud de arrepentimiento con su código de comprobante (`ARR-` y 6 dígitos de
 * `withdrawal_code_seq`) y la deja en la bandeja como mensaje `withdrawal`. Con el campo trampa
 * lleno igual toma un número y responde con su código, pero no guarda nada. El comprobante por
 * mail llega en B7: por ahora queda la intención en el log, sin datos personales.
 */
export class RequestWithdrawalCommand {
  /**
   * @param messages - Bandeja.
   * @param mailLog - Registro de los mails que todavía no salen.
   */
  constructor(
    private readonly messages: Pick<ContactMessageRepository, 'nextWithdrawalNumber' | 'create'>,
    private readonly mailLog: SupportMailLog = SILENT_SUPPORT_MAIL_LOG,
  ) {}

  /**
   * Toma el próximo código y guarda la solicitud, salvo que el campo trampa venga lleno.
   *
   * @param input - Solicitud ya validada.
   * @returns El comprobante con el código.
   * @throws {RangeError} En español, si la secuencia ya pasó de 999.999.
   * @throws {TypeError} En español, si falta el nombre o el email.
   */
  async execute(input: WithdrawalInput): Promise<WithdrawalReceipt> {
    const code = formatWithdrawalCode(await this.messages.nextWithdrawalNumber())
    if (isHoneypotFilled(input.website)) return { code }
    await this.messages.create(
      createContactMessage({
        kind: 'withdrawal',
        name: input.name,
        email: input.email,
        orderNumber: input.orderNumber,
        reason: null,
        message: input.comment,
        code,
      }),
    )
    this.mailLog.log(`Arrepentimiento ${code} en la bandeja: el comprobante por mail llega en B7.`)
    return { code }
  }
}
