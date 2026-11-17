import { isHoneypotFilled } from '../../../../shared/domain/honeypot'
import {
  createContactMessage,
  formatWithdrawalCode,
  WITHDRAWAL_CODE_MAX,
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
 * Registra una solicitud de arrepentimiento con su código de comprobante (`ARR-` y 6 dígitos o
 * más de `withdrawal_code_seq`) y la deja en la bandeja como mensaje `withdrawal`. Con el campo
 * trampa lleno responde el código que seguiría, sin consumirlo ni guardar nada (como el mock: el
 * próximo real puede llevar el mismo número), así los bots no agotan la secuencia. El comprobante
 * por mail lo manda `notifications` con el evento `withdrawal.requested` que guarda el repositorio.
 */
export class RequestWithdrawalCommand {
  /**
   * @param messages - Bandeja.
   * @param mailLog - Registro de los mails que todavía no salen.
   */
  constructor(
    private readonly messages: Pick<
      ContactMessageRepository,
      'nextWithdrawalNumber' | 'peekWithdrawalNumber' | 'create'
    >,
    private readonly mailLog: SupportMailLog = SILENT_SUPPORT_MAIL_LOG,
  ) {}

  /**
   * Toma el próximo código y guarda la solicitud. Con el campo trampa lleno solo mira el código
   * que seguiría (con la secuencia agotada, el último), sin tomarlo.
   *
   * @param input - Solicitud ya validada.
   * @returns El comprobante con el código.
   * @throws {RangeError} En español, si la secuencia ya pasó de `WITHDRAWAL_CODE_MAX` (nunca con la
   *   trampa).
   * @throws {TypeError} En español, si falta el nombre o el email.
   */
  async execute(input: WithdrawalInput): Promise<WithdrawalReceipt> {
    if (isHoneypotFilled(input.website)) {
      const next = await this.messages.peekWithdrawalNumber()
      return { code: formatWithdrawalCode(Math.min(next, WITHDRAWAL_CODE_MAX)) }
    }
    const code = formatWithdrawalCode(await this.messages.nextWithdrawalNumber())
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
    this.mailLog.log(`Arrepentimiento ${code} en la bandeja: el comprobante sale por mail.`)
    return { code }
  }
}
