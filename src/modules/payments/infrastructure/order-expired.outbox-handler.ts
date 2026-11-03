import { Inject, Injectable } from '@nestjs/common'

import {
  type OutboxEventHandler,
  OutboxHandlerRegistry,
} from '../../../shared/infrastructure/outbox/outbox-handler.registry'
import type { OutboxJobData } from '../../../shared/infrastructure/outbox/outbox.relay'
import { ORDER_EXPIRED_EVENT } from '../../orders/domain/order-events'
import { OnOrderExpiredCommand } from '../application/commands/on-order-expired.command'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Handler de `order.expired` del outbox (Ruling B-43): cancela el intento activo del pedido
 * vencido, con mejor esfuerzo vence la preferencia o cancela el pago en Mercado Pago, y devuelve
 * los aprobados que el pedido cobró sin completarse ({@link OnOrderExpiredCommand}). Se registra
 * en {@link OutboxHandlerRegistry} al crearse; el despacho lo hace `OutboxDispatcherProcessor`.
 */
@Injectable()
export class OrderExpiredOutboxHandler implements OutboxEventHandler {
  /**
   * @param registry - Registro de handlers del outbox (acá se anota para `order.expired`).
   * @param onOrderExpired - Cierre de los pagos de un pedido vencido.
   */
  constructor(
    registry: OutboxHandlerRegistry,
    @Inject(OnOrderExpiredCommand) private readonly onOrderExpired: OnOrderExpiredCommand,
  ) {
    registry.register(ORDER_EXPIRED_EVENT, this)
  }

  /**
   * Cierra los pagos del pedido vencido.
   *
   * @param event - Evento `order.expired` (con `payload.orderId`).
   * @throws {TypeError} En español, si el evento no trae el id del pedido (el job falla).
   */
  async handle(event: OutboxJobData): Promise<void> {
    const payload: unknown = isRecord(event) ? event.payload : undefined
    const orderId = isRecord(payload) ? payload.orderId : undefined
    if (typeof orderId !== 'string' || orderId === '') {
      throw new TypeError(`El evento ${event.id} (order.expired) no trae el id del pedido`)
    }
    await this.onOrderExpired.execute(orderId)
  }
}
