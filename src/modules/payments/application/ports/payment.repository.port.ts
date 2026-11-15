import type { NewDomainEvent } from '../../../../shared/domain/domain-event'
import type { PaymentMethod, PaymentStatus } from '../../../orders/domain/order-status'
import type { PaymentAttempt, PaymentProvider, RefundReason } from '../../domain/payment-attempt'

/** Intento nuevo (nace en `none`). */
export interface NewPaymentAttempt {
  /** Id (uuid v7). */
  id: string
  /** Pedido. */
  orderId: string
  /** Forma de pago. */
  method: PaymentMethod
  /** Monto, en pesos. */
  amountArs: number
  /** Clave idempotente (la `Idempotency-Key` de la tienda, o una propia). */
  idempotencyKey: string
  /** Email del pagador (tarjeta), o `null`. */
  payerEmail: string | null
  /** Creación. */
  createdAt: Date
}

/** Cambios de un intento; solo se tocan las claves presentes. */
export interface PaymentAttemptPatch {
  /** Estado normalizado (si cambia, se sincroniza `orders.payment_status`). */
  status?: PaymentStatus
  /** `status` crudo. */
  providerStatus?: string | null
  /** `status_detail` crudo. */
  statusDetail?: string | null
  /** Id del pago en Mercado Pago. */
  providerPaymentId?: string | null
  /** Id de la preferencia. */
  providerPreferenceId?: string | null
  /** Dirección de pago de la preferencia. */
  initPoint?: string | null
  /** Dirección del desafío 3-D Secure. */
  challengeUrl?: string | null
  /** Monto que informa la pasarela, en pesos. */
  amountArs?: number
  /** Monto devuelto, en pesos. */
  refundedArs?: number
  /** Cuotas. */
  installments?: number | null
  /** Tipo de medio. */
  paymentTypeId?: string | null
  /** Marca de la tarjeta. */
  cardBrand?: string | null
  /** Últimos 4. */
  cardLastFour?: string | null
  /** Banco emisor. */
  issuerId?: string | null
  /** Si queda activo. */
  isActive?: boolean
  /**
   * Clave idempotente nueva. Solo para liberar la de un intento que la pasarela dejó cancelado
   * (la columna es única y la tienda reintenta con la misma clave): ver `releasedIdempotencyKey`.
   */
  idempotencyKey?: string
  /** Cuándo se aprobó. */
  approvedAt?: Date | null
}

/** Devolución nueva (se guarda antes de llamar a la pasarela). */
export interface NewRefund {
  /** Id (uuid v7). */
  id: string
  /** Intento devuelto. */
  paymentId: string
  /** Monto, en pesos. */
  amountArs: number
  /** Motivo. */
  reason: RefundReason
  /** Clave idempotente propia (`X-Idempotency-Key` de la devolución). */
  idempotencyKey: string
  /** Creación. */
  createdAt: Date
}

/** Una devolución (fila de `refunds`). */
export interface Refund extends NewRefund {
  /** Id en Mercado Pago, o `null` hasta que responde. */
  providerRefundId: string | null
  /** `pending` al crearse; `approved`/`pending` según la pasarela; `failed` si falló. */
  status: 'pending' | 'approved' | 'failed'
  /** Error de la pasarela si falló. */
  lastError: string | null
}

/** Intentos de pago y devoluciones (tablas `payments` y `refunds`). */
export interface PaymentRepository {
  /**
   * Desactiva (status `cancelled`, `isActive` false) el activo anterior del pedido y crea el nuevo
   * activo en status `none`; sincroniza `orders.payment_status`, todo en una transacción. La
   * implementación Prisma escribe esa columna de `orders` con el mismo `tx` (excepción explícita
   * al ADR 0001, Ruling B-45); no pasa por `OrderPaymentsPort.setPaymentStatus`.
   *
   * Con el pedido bloqueado, si ya tiene `MAX_PAYMENT_ATTEMPTS_PER_ORDER` intentos no crea nada
   * (auditoría NV-16).
   *
   * @param input - Intento nuevo.
   * @returns El intento creado y el anterior ya cancelado (o `null` si no había).
   * @throws {PaymentAttemptsExhaustedError} 409 si el pedido llegó al tope de intentos.
   */
  startAttempt(
    input: NewPaymentAttempt,
  ): Promise<{ attempt: PaymentAttempt; previous: PaymentAttempt | null }>
  /**
   * Crea un intento inactivo en `none`, sin tocar el activo del pedido ni `orders.payment_status`
   * (registra un pago que llegó de Mercado Pago sin intento propio).
   *
   * @param input - Intento a registrar.
   * @returns El intento creado.
   */
  recordAttempt(input: NewPaymentAttempt): Promise<PaymentAttempt>
  /**
   * @param id - Id del intento.
   * @returns El intento, o `null`.
   */
  findById(id: string): Promise<PaymentAttempt | null>
  /**
   * Busca por la clave exacta: una clave soltada (`<clave>:released:<id>`, ver
   * `releasedIdempotencyKey`) no aparece al buscar la original.
   *
   * @param key - Clave idempotente del intento (la `Idempotency-Key` de la tienda, tal cual).
   * @returns El intento que tiene esa clave, o `null`.
   */
  findByIdempotencyKey(key: string): Promise<PaymentAttempt | null>
  /**
   * @param orderId - Id del pedido.
   * @returns El intento activo del pedido, o `null`.
   */
  findActiveByOrder(orderId: string): Promise<PaymentAttempt | null>
  /**
   * @param provider - Pasarela.
   * @param providerPaymentId - Id del pago en la pasarela.
   * @returns El intento con ese pago, o `null`.
   */
  findByProviderPaymentId(
    provider: PaymentProvider,
    providerPaymentId: string,
  ): Promise<PaymentAttempt | null>
  /**
   * @param provider - Pasarela.
   * @param preferenceId - Id de la preferencia.
   * @returns El intento con esa preferencia, o `null`.
   */
  findByPreferenceId(
    provider: PaymentProvider,
    preferenceId: string,
  ): Promise<PaymentAttempt | null>
  /**
   * @param orderId - Id del pedido.
   * @returns Los intentos del pedido, del más viejo al más nuevo.
   */
  listByOrder(orderId: string): Promise<PaymentAttempt[]>
  /**
   * Aplica el parche y, si cambia el status y el intento es el vigente del pedido (estaba activo,
   * o el pedido no tiene otro activo), sincroniza `orders.payment_status` (Ruling B-45: un estado
   * tardío de un intento reemplazado no pisa al activo); los eventos van al outbox, todo en la
   * misma transacción. Como en `startAttempt`, la implementación Prisma escribe
   * `orders.payment_status` con el mismo `tx` (Ruling B-45): una caída entre las dos escrituras
   * no puede dejar al pedido en `pending` con el intento ya `rejected`/`cancelled` (que no vence).
   *
   * @param id - Id del intento.
   * @param patch - Cambios.
   * @param events - Eventos del outbox (por defecto, ninguno).
   * @returns El intento actualizado.
   */
  update(
    id: string,
    patch: PaymentAttemptPatch,
    events?: readonly NewDomainEvent[],
  ): Promise<PaymentAttempt>
  /**
   * Cancela el intento (`cancelled`, inactivo, sin desafío) solo si sigue activo: con el intento
   * bloqueado, si otro proceso ya lo aprobó, lo rechazó o lo cerró, no lo toca (auditoría NV-06: un
   * estado final nunca retrocede). Sincroniza `orders.payment_status` como {@link update}.
   *
   * @param id - Id del intento.
   * @returns El intento cancelado, o `null` si ya no estaba activo (o no existe).
   */
  cancelActive(id: string): Promise<PaymentAttempt | null>
  /**
   * Corre `work` con el pedido bloqueado para los pagos: otra llamada con el mismo pedido espera a
   * que termine (auditoría NV-04: dos aplicaciones de la misma aprobación no deciden con lecturas
   * viejas). La implementación Prisma toma `pg_advisory_xact_lock` en una transacción abierta
   * mientras dura `work`, así que vale entre instancias. `work` no puede volver a pedir el bloqueo
   * del mismo pedido (esperaría para siempre).
   *
   * @param orderId - Id del pedido.
   * @param work - Lo que se hace con el bloqueo.
   * @returns Lo que devuelve `work`.
   */
  serializeByOrder<T>(orderId: string, work: () => Promise<T>): Promise<T>
  /**
   * @param input - Devolución nueva (status `pending`).
   * @returns La devolución guardada.
   */
  createRefund(input: NewRefund): Promise<Refund>
  /**
   * @param id - Id de la devolución.
   * @param patch - Respuesta de la pasarela o el error.
   * @returns La devolución actualizada.
   */
  updateRefund(
    id: string,
    patch: {
      providerRefundId?: string | null
      status?: Refund['status']
      lastError?: string | null
    },
  ): Promise<Refund>
  /**
   * @param paymentId - Id del intento.
   * @param reason - Motivo.
   * @returns La devolución de ese intento con ese motivo, o `null`.
   */
  findRefundByPayment(paymentId: string, reason: Refund['reason']): Promise<Refund | null>
}

/** Token de inyección del {@link PaymentRepository}. */
export const PAYMENT_REPOSITORY = Symbol('PAYMENT_REPOSITORY')
