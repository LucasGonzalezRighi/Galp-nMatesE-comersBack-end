import { Injectable } from '@nestjs/common'

import type { OutboxJobData } from './outbox.relay'

/**
 * Quien reacciona a un tipo de evento del outbox. Tiene que ser idempotente: si falla cualquiera
 * de los handlers del tipo, BullMQ reintenta el job entero y corren otra vez todos. Por eso lo
 * lento o lo que depende de otro sistema va en su propia cola (el handler solo encola).
 */
export interface OutboxEventHandler {
  /**
   * Reacciona al evento.
   *
   * @param event - Datos del job (el evento tal como lo publicó el relay).
   * @throws Si falla: el job del outbox falla y se reintenta.
   */
  handle(event: OutboxJobData): Promise<void>
}

/**
 * Registro de los handlers de cada tipo de evento del outbox, que usa
 * `OutboxDispatcherProcessor` para despachar cada job.
 *
 * Los handlers se registran **en su constructor**: Nest crea todos los providers antes de llamar
 * a cualquier `onModuleInit`, y el worker del outbox se crea en `onModuleInit`, así que un job
 * pendiente de antes de un reinicio nunca encuentra el registro incompleto.
 */
@Injectable()
export class OutboxHandlerRegistry {
  private readonly handlers = new Map<string, OutboxEventHandler[]>()

  /**
   * Registra un handler para un tipo de evento (puede haber varios por tipo; corren en el orden
   * en que se registraron).
   *
   * @param type - Tipo del evento, por ejemplo `order.expired`.
   * @param handler - Quien lo atiende.
   * @throws {TypeError} En español, si el tipo está vacío o el handler no tiene `handle`.
   */
  register(type: string, handler: OutboxEventHandler): void {
    if (type.trim() === '') {
      throw new TypeError('Un handler del outbox necesita el tipo de evento')
    }
    if (typeof (handler as Partial<OutboxEventHandler>).handle !== 'function') {
      throw new TypeError(`El handler del outbox para ${type} no tiene handle`)
    }
    const handlers = this.handlers.get(type)
    if (handlers === undefined) this.handlers.set(type, [handler])
    else handlers.push(handler)
  }

  /**
   * Handlers de un tipo de evento.
   *
   * @param type - Tipo del evento.
   * @returns Los handlers en orden de registro; vacío si no hay ninguno.
   */
  handlersFor(type: string): readonly OutboxEventHandler[] {
    return this.handlers.get(type) ?? []
  }
}
