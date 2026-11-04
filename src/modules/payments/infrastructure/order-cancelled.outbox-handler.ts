import { Inject, Injectable } from '@nestjs/common'

import {
  type OutboxEventHandler,
  OutboxHandlerRegistry,
} from '../../../shared/infrastructure/outbox/outbox-handler.registry'
import type { OutboxJobData } from '../../../shared/infrastructure/outbox/outbox.relay'
import { ORDER_CANCELLED_EVENT } from '../../orders/domain/order-events'
import { OnOrderCancelledCommand } from '../application/commands/on-order-cancelled.command'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Handler de `order.cancelled` del outbox (Ruling B-75): cierra en Mercado Pago el intento que se
 * canceló con el pedido y devuelve lo cobrado ({@link OnOrderCancelledCommand}). Se registra en
 * {@link OutboxHandlerRegistry} al crearse; el despacho lo hace `OutboxDispatcherProcessor`.
 */
@Injectable()
export class OrderCancelledOutboxHandler implements OutboxEventHandler {
  /**
   * @param registry - Registro de handlers del outbox (acá se anota para `order.cancelled`).
   * @param onOrderCancelled - Cierre de los pagos de un pedido cancelado.
   */
  constructor(
    registry: OutboxHandlerRegistry,
    @Inject(OnOrderCancelledCommand) private readonly onOrderCancelled: OnOrderCancelledCommand,
  ) {
    registry.register(ORDER_CANCELLED_EVENT, this)
  }

  /**
   * Cierra los pagos del pedido cancelado.
   *
   * @param event - Evento `order.cancelled` (con `payload.orderId` y `payload.cancelledAttemptId`).
   * @throws {TypeError} En español, si el evento no trae el id del pedido o el del intento no es
   *   un texto ni `null` (el job falla).
   */
  async handle(event: OutboxJobData): Promise<void> {
    const payload: unknown = isRecord(event) ? event.payload : undefined
    const orderId = isRecord(payload) ? payload.orderId : undefined
    if (typeof orderId !== 'string' || orderId === '') {
      throw new TypeError(`El evento ${event.id} (order.cancelled) no trae el id del pedido`)
    }
    const attemptId = isRecord(payload) ? payload.cancelledAttemptId : undefined
    if (attemptId !== null && (typeof attemptId !== 'string' || attemptId === '')) {
      throw new TypeError(
        `El evento ${event.id} (order.cancelled) no trae el intento cancelado (texto o null)`,
      )
    }
    await this.onOrderCancelled.execute(orderId, attemptId)
  }
}
