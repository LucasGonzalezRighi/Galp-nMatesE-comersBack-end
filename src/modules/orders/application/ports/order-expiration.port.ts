/** Programa el vencimiento de un pedido (job diferido `order.expire` de la cola `order-expiration`). */
export interface OrderExpirationSchedulerPort {
  /**
   * Programa el vencimiento. **Nunca lanza**: si la cola no responde, el adaptador lo anota como
   * `warn` y el barrido o la lectura vencen el pedido igual.
   *
   * @param orderId - Id del pedido (también es el `jobId`).
   * @param at - Momento del vencimiento (`reservedUntil`).
   */
  schedule(orderId: string, at: Date): Promise<void>
}

/** Token de inyección del {@link OrderExpirationSchedulerPort}. */
export const ORDER_EXPIRATION_SCHEDULER = Symbol('ORDER_EXPIRATION_SCHEDULER')
