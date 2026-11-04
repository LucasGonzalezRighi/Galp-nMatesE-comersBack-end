import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common'
import {
  ApiAcceptedResponse,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger'

import { ApiProblemResponses } from '../../../shared/infrastructure/http/openapi'
import { RequestWithdrawalCommand } from '../application/commands/request-withdrawal.command'
import { SendContactMessageCommand } from '../application/commands/send-contact-message.command'
import type { WithdrawalReceipt } from '../application/read-models'
import { ContactInputDto, WithdrawalInputDto } from './dto/contact-input.dto'
import { WithdrawalReceiptDto } from './dto/support.response.dto'

/**
 * Formularios públicos de la bandeja: contacto (`POST /contact`) y botón de arrepentimiento
 * (`POST /withdrawals`). Llevan el límite global de pedidos por IP, como `POST /orders`. El pipe
 * valida antes que el campo trampa: con la trampa llena y otro campo inválido responde 422; con
 * la trampa llena y lo demás válido, responde como si hubiera funcionado y no guarda nada.
 */
@ApiTags('contact')
@ApiExtraModels(WithdrawalReceiptDto)
@Controller()
export class ContactController {
  /**
   * @param sendContactMessage - Mensaje de contacto.
   * @param requestWithdrawal - Solicitud de arrepentimiento.
   */
  constructor(
    private readonly sendContactMessage: SendContactMessageCommand,
    private readonly requestWithdrawal: RequestWithdrawalCommand,
  ) {}

  /**
   * Deja el mensaje en la bandeja del dashboard.
   *
   * @param body - Mensaje ya validado.
   */
  @Post('contact')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ operationId: 'sendContactMessage', summary: 'Enviar un mensaje de contacto' })
  @ApiAcceptedResponse({ description: 'Mensaje recibido.' })
  @ApiProblemResponses(422, 429, 500)
  async send(@Body() body: ContactInputDto): Promise<void> {
    await this.sendContactMessage.execute(body.toInput())
  }

  /**
   * Registra la solicitud de arrepentimiento y devuelve su código de comprobante.
   *
   * @param body - Solicitud ya validada.
   * @returns El comprobante (201), también cuando el campo trampa la descartó.
   */
  @Post('withdrawals')
  @ApiOperation({
    operationId: 'requestWithdrawal',
    summary: 'Pedir el arrepentimiento de una compra',
  })
  @ApiCreatedResponse({ type: WithdrawalReceiptDto, description: 'Solicitud registrada.' })
  @ApiProblemResponses(422, 429, 500)
  withdraw(@Body() body: WithdrawalInputDto): Promise<WithdrawalReceipt> {
    return this.requestWithdrawal.execute(body.toInput())
  }
}
