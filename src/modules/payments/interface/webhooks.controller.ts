import { Controller, HttpCode, HttpStatus, Post } from '@nestjs/common'
import { ApiBody, ApiHeader, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger'
import { SkipThrottle } from '@nestjs/throttler'

import { ApiProblemResponses, schemaRef } from '../../../shared/infrastructure/http/openapi'
import {
  type IncomingWebhook,
  ReceiveWebhookCommand,
} from '../application/commands/receive-webhook.command'
import { MercadoPagoNotification } from './payments-http'

/**
 * Notificaciones de Mercado Pago (`POST /webhooks/mercadopago`), sin sesión ni CSRF
 * (`security: []`) y sin límite por IP (Mercado Pago reintenta desde sus IPs). El cuerpo se lee
 * sin DTO: el formato de Mercado Pago trae más campos que el contrato y no se rechazan. Responde
 * 200 si la registró (o la ignora, como el formato IPN), 401 si la firma no vale y 500 si no la
 * pudo encolar ni procesar; nunca 404, 409 ni 422.
 */
@ApiTags('payments')
@SkipThrottle()
@Controller('webhooks')
export class WebhooksController {
  /** @param receiveWebhook - Validación de la firma, registro y encolado. */
  constructor(private readonly receiveWebhook: ReceiveWebhookCommand) {}

  /**
   * Valida `x-signature`, registra la notificación una sola vez y la encola para procesarla.
   *
   * @param notification - Cabeceras, queries y cuerpo tal como llegaron.
   * @throws {InvalidSignatureError} 401 si la firma falta, no coincide o no hay secreto.
   */
  @Post('mercadopago')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'receiveMercadoPagoWebhook',
    summary: 'Recibir una notificación de Mercado Pago',
  })
  @ApiHeader({
    name: 'x-signature',
    required: true,
    description: 'Firma de la notificación, con el formato `ts=<marca de tiempo>,v1=<hash>`.',
    schema: { type: 'string' },
  })
  @ApiHeader({
    name: 'x-request-id',
    required: true,
    description: 'Identificador de la solicitud que genera Mercado Pago.',
    schema: { type: 'string' },
  })
  @ApiQuery({
    name: 'data.id',
    required: false,
    description: 'Identificador del pago, repetido en la dirección.',
    schema: { type: 'string' },
  })
  @ApiBody({ required: true, schema: schemaRef('MercadoPagoWebhookEvent') })
  @ApiOkResponse({ description: 'Notificación registrada.' })
  @ApiProblemResponses(401, 500)
  async receive(@MercadoPagoNotification() notification: IncomingWebhook): Promise<void> {
    await this.receiveWebhook.execute(notification)
  }
}
