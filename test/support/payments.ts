import { createHash, createHmac } from 'node:crypto'

import type {
  OrderForPayment,
  OrderPaymentsPort,
} from '../../src/modules/orders/application/ports/order-payments.port'
import type { OrderEvents } from '../../src/modules/orders/application/ports/order.repository.port'
import { placeOrder, type Order } from '../../src/modules/orders/domain/order.entity'
import {
  EXPIRABLE_PAYMENT_STATUSES,
  type OrderStatus,
  type PaymentMethod,
  type PaymentStatus,
} from '../../src/modules/orders/domain/order-status'
import type {
  CardChargeInput,
  InstallmentsRequest,
  PaymentGatewayPort,
  PreferenceInput,
  PreferenceResult,
  RefundResult,
} from '../../src/modules/payments/application/ports/payment-gateway.port'
import type {
  NewPaymentAttempt,
  NewRefund,
  PaymentAttemptPatch,
  PaymentRepository,
  Refund,
} from '../../src/modules/payments/application/ports/payment.repository.port'
import type { PaymentsLogger } from '../../src/modules/payments/application/ports/payments-logger.port'
import type { PaymentsSettings } from '../../src/modules/payments/application/ports/payments-settings.port'
import type {
  NewWebhookEvent,
  StoredWebhookEvent,
  WebhookEventRepository,
} from '../../src/modules/payments/application/ports/webhook-event.repository.port'
import type { WebhookQueuePort } from '../../src/modules/payments/application/ports/webhook-queue.port'
import { ApplyProviderPaymentCommand } from '../../src/modules/payments/application/commands/apply-provider-payment.command'
import { CancelPaymentCommand } from '../../src/modules/payments/application/commands/cancel-payment.command'
import { CreatePreferenceCommand } from '../../src/modules/payments/application/commands/create-preference.command'
import { OnOrderExpiredCommand } from '../../src/modules/payments/application/commands/on-order-expired.command'
import { PayWithCardCommand } from '../../src/modules/payments/application/commands/pay-with-card.command'
import { ProcessWebhookEventCommand } from '../../src/modules/payments/application/commands/process-webhook-event.command'
import { ReceiveWebhookCommand } from '../../src/modules/payments/application/commands/receive-webhook.command'
import { ReconcilePendingPaymentsCommand } from '../../src/modules/payments/application/commands/reconcile-pending-payments.command'
import { SimulateProviderResultCommand } from '../../src/modules/payments/application/commands/simulate-provider-result.command'
import { PaymentOrderAccess } from '../../src/modules/payments/application/order-access'
import { GetInstallmentsQuery } from '../../src/modules/payments/application/queries/get-installments.query'
import { FixedClock } from './identity'
import { FixedSecrets } from './session'
import {
  simulatedInstallments,
  type InstallmentOption,
} from '../../src/modules/payments/domain/installments'
import type {
  PaymentAttempt,
  PaymentProvider,
} from '../../src/modules/payments/domain/payment-attempt'
import {
  InstallmentsNotAvailableError,
  InvalidCardTokenError,
} from '../../src/modules/payments/domain/payments-errors'
import type { ProviderPayment } from '../../src/modules/payments/domain/provider-payment'
import {
  parseSimulatedToken,
  simulatedOutcome,
} from '../../src/modules/payments/domain/simulated-cards'
import type { Clock } from '../../src/shared/domain/clock'
import type { NewDomainEvent } from '../../src/shared/domain/domain-event'
import { newId } from '../../src/shared/domain/id'

/** Origen de la tienda en los tests. */
export const STORE_ORIGIN = 'http://localhost:4300'

/** Origen del simulador en los tests. */
export const SIMULATOR_ORIGIN = 'http://localhost:3001'

/** Secreto de webhooks de los tests. */
export const WEBHOOK_SECRET = 'secreto-de-prueba'

/** Total del pedido de prueba (el del caso de cuotas del mock). */
export const ORDER_TOTAL = 68397

/** Token de un pedido de prueba. */
export const ORDER_TOKEN = 'token-del-pedido'

/**
 * Token de tarjeta del simulador.
 *
 * @param holder - Titular (`APRO`, `3DS`…).
 * @param lastFour - Últimos 4 dígitos.
 * @returns `sim_<TITULAR>_<4>_<32 hex>` (cada llamada con un sufijo distinto).
 */
export function simToken(holder: string, lastFour = '3704'): string {
  return `sim_${holder}_${lastFour}_${newId().replaceAll('-', '')}`
}

/**
 * HMAC-SHA256 en hex, como el adaptador de infraestructura.
 *
 * @param secret - Secreto.
 * @param manifest - Manifiesto firmado.
 * @returns El hash en hex.
 */
export function hmacSha256Hex(secret: string, manifest: string): string {
  return createHmac('sha256', secret).update(manifest).digest('hex')
}

/**
 * Cabecera `x-signature` válida para una notificación.
 *
 * @param input - `data.id`, `x-request-id`, `ts` y el secreto (por defecto {@link WEBHOOK_SECRET}).
 * @returns `ts=<ts>,v1=<hex>`.
 */
export function signWebhook(input: {
  dataId: string | null
  requestId: string | null
  ts?: string
  secret?: string
}): string {
  const ts = input.ts ?? '1704908010'
  const segments: string[] = []
  if (input.dataId !== null) segments.push(`id:${input.dataId.toLowerCase()}`)
  if (input.requestId !== null) segments.push(`request-id:${input.requestId}`)
  segments.push(`ts:${ts}`)
  const v1 = hmacSha256Hex(input.secret ?? WEBHOOK_SECRET, `${segments.join(';')};`)
  return `ts=${ts},v1=${v1}`
}

/** Lo que se puede fijar de un pedido de prueba. */
export interface PaymentOrderSeed {
  /** Número (por defecto `GLP-0000N` correlativo). */
  number?: string
  /** Estado (por defecto `pending_payment`). */
  status?: OrderStatus
  /** Estado del pago (por defecto `none`). */
  paymentStatus?: PaymentStatus
  /** Forma de pago del checkout (por defecto `card`). */
  paymentMethod?: PaymentMethod
  /** Total (por defecto {@link ORDER_TOTAL}). */
  totalArs?: number
  /** Costo de envío (por defecto 0). */
  shippingCostArs?: number
  /** Token (por defecto {@link ORDER_TOKEN}). */
  token?: string
  /** Creación (por defecto la hora del reloj). */
  createdAt?: Date
  /** Vencimiento de la reserva (por defecto creación + 30 min). */
  reservedUntil?: Date
}

/** Pedido de prueba con su token. */
export type SeededOrder = OrderForPayment & { token: string }

interface StubOrder {
  order: Order
  lines: OrderForPayment['lines']
}

/**
 * Doble propio de {@link OrderPaymentsPort} para los tests de `payments` (la Task 2 escribe el
 * oficial en `test/support/orders.ts`). Arma los pedidos con `placeOrder` del dominio y también
 * hace de `ExpireOrdersCommand.expireOne`.
 */
export class InMemoryOrderPaymentsStub implements OrderPaymentsPort {
  /** Eventos que llegaron por `markPaid`/`markRefunded`. */
  readonly events: NewDomainEvent[] = []
  /** Cuántas veces se confirmó el stock (`markPaid` que pagó). */
  paidCount = 0
  /** Cuántas veces se vencieron pedidos. */
  expiredCount = 0
  private readonly orders = new Map<string, StubOrder>()
  private sequence = 0

  /** @param clock - Reloj de prueba (creación y vencimiento). */
  constructor(private readonly clock: Clock) {}

  /**
   * Agrega un pedido.
   *
   * @param seed - Lo que se quiere fijar.
   * @returns El pedido para pagos y su token.
   */
  add(seed: PaymentOrderSeed = {}): SeededOrder {
    this.sequence += 1
    const createdAt = seed.createdAt ?? this.clock.now()
    const total = seed.totalArs ?? ORDER_TOTAL
    const token = seed.token ?? ORDER_TOKEN
    const placed = placeOrder(
      {
        id: newId(),
        number: null,
        customerId: null,
        contact: { email: 'ana@example.com', firstName: 'Ana', lastName: 'Pérez', phone: null },
        shipping: {
          method: 'home',
          address: null,
          costArs: seed.shippingCostArs ?? 0,
          eta: '3 a 5 días hábiles',
        },
        lines: [],
        reservation: [],
        itemsGrossArs: total,
        kitSavingsArs: 0,
        subtotalArs: total,
        totalArs: total,
        kitDiscountPercent: 0,
        paymentMethod: seed.paymentMethod ?? 'card',
        accessTokenHash: createHash('sha256').update(token, 'utf8').digest('hex'),
        createdAt,
        reservedUntil: seed.reservedUntil ?? new Date(createdAt.getTime() + 30 * 60_000),
      },
      seed.number ?? `GLP-${String(this.sequence).padStart(5, '0')}`,
    )
    const order: Order = {
      ...placed,
      status: seed.status ?? 'pending_payment',
      paymentStatus: seed.paymentStatus ?? 'none',
    }
    const lines = [{ id: newId(), name: 'Mate Imperial', quantity: 1, totalArs: total }]
    this.orders.set(order.id, { order, lines })
    return { ...this.toForPayment({ order, lines }), token }
  }

  /**
   * @param orderId - Id del pedido.
   * @returns El pedido como lo tiene el doble.
   * @throws {Error} Si no existe.
   */
  get(orderId: string): Order {
    const stored = this.orders.get(orderId)
    if (stored === undefined) throw new Error(`No hay un pedido ${orderId} en el doble`)
    return stored.order
  }

  /** {@inheritDoc OrderPaymentsPort.findForPayment} */
  findForPayment(number: string): Promise<OrderForPayment | null> {
    const stored = [...this.orders.values()].find((entry) => entry.order.number === number)
    return Promise.resolve(stored === undefined ? null : this.toForPayment(stored))
  }

  /** {@inheritDoc OrderPaymentsPort.findForPaymentById} */
  findForPaymentById(orderId: string): Promise<OrderForPayment | null> {
    const stored = this.orders.get(orderId)
    return Promise.resolve(stored === undefined ? null : this.toForPayment(stored))
  }

  /** {@inheritDoc OrderPaymentsPort.markPaid} */
  markPaid(orderId: string, paidAt: Date, events: OrderEvents): Promise<Order | null> {
    const stored = this.orders.get(orderId)
    if (stored?.order.status !== 'pending_payment') {
      return Promise.resolve(null)
    }
    stored.order = {
      ...stored.order,
      status: 'paid',
      paymentStatus: 'approved',
      history: [...stored.order.history, { status: 'paid', at: paidAt, note: null }],
    }
    this.paidCount += 1
    this.events.push(...events(stored.order))
    return Promise.resolve(stored.order)
  }

  /** {@inheritDoc OrderPaymentsPort.setPaymentStatus} */
  setPaymentStatus(orderId: string, status: PaymentStatus): Promise<void> {
    const stored = this.orders.get(orderId)
    if (stored !== undefined) stored.order = { ...stored.order, paymentStatus: status }
    return Promise.resolve()
  }

  /** {@inheritDoc OrderPaymentsPort.markRefunded} */
  markRefunded(orderId: string, at: Date, events: OrderEvents): Promise<Order | null> {
    const stored = this.orders.get(orderId)
    const refundable: readonly OrderStatus[] = ['paid', 'preparing', 'shipped', 'delivered']
    if (stored === undefined || !refundable.includes(stored.order.status)) {
      return Promise.resolve(null)
    }
    stored.order = {
      ...stored.order,
      status: 'refunded',
      paymentStatus: 'refunded',
      history: [...stored.order.history, { status: 'refunded', at, note: null }],
    }
    this.events.push(...events(stored.order))
    return Promise.resolve(stored.order)
  }

  /** {@inheritDoc OrderPaymentsPort.listAwaitingPayment} */
  listAwaitingPayment(cutoff: Date, limit: number): Promise<OrderForPayment[]> {
    const awaiting = [...this.orders.values()]
      .filter(
        ({ order }) =>
          order.status === 'pending_payment' &&
          (order.paymentStatus === 'pending' || order.paymentStatus === 'action_required') &&
          order.reservedUntil.getTime() <= cutoff.getTime(),
      )
      .sort((a, b) => a.order.reservedUntil.getTime() - b.order.reservedUntil.getTime())
      .slice(0, limit)
    return Promise.resolve(awaiting.map((entry) => this.toForPayment(entry)))
  }

  /**
   * Como `ExpireOrdersCommand.expireOne`: vence si sigue `pending_payment`, con un pago vencible y
   * la reserva cumplida.
   *
   * @param orderId - Id del pedido.
   * @returns El pedido vencido, o `null` si no correspondía.
   */
  expireOne(orderId: string): Promise<Order | null> {
    const stored = this.orders.get(orderId)
    const now = this.clock.now()
    if (
      stored?.order.status !== 'pending_payment' ||
      !(EXPIRABLE_PAYMENT_STATUSES as readonly PaymentStatus[]).includes(
        stored.order.paymentStatus,
      ) ||
      stored.order.reservedUntil.getTime() > now.getTime()
    ) {
      return Promise.resolve(null)
    }
    stored.order = {
      ...stored.order,
      status: 'expired',
      history: [
        ...stored.order.history,
        { status: 'expired', at: stored.order.reservedUntil, note: null },
      ],
    }
    this.expiredCount += 1
    return Promise.resolve(stored.order)
  }

  private toForPayment({ order, lines }: StubOrder): OrderForPayment {
    return {
      id: order.id,
      number: order.number,
      status: order.status,
      paymentStatus: order.paymentStatus,
      paymentMethod: order.paymentMethod,
      totalArs: order.totalArs,
      shippingCostArs: order.shipping.costArs,
      accessTokenHash: order.accessTokenHash,
      reservedUntil: order.reservedUntil,
      createdAt: order.createdAt,
      customerId: order.customerId,
      contact: order.contact,
      lines: lines.map((line) => ({ ...line })),
    }
  }
}

/** Compara pasarelas como texto (hoy hay una sola, pero el filtro queda como en la base). */
function sameProvider(a: PaymentProvider, b: PaymentProvider): boolean {
  return (a as string) === b
}

/**
 * {@link PaymentRepository} en memoria, con las restricciones de la base (un activo por pedido,
 * `idempotency_key` y `(provider, provider_payment_id)` únicos) y la sincronización de
 * `orders.payment_status` contra el doble de pedidos.
 */
export class InMemoryPaymentRepository implements PaymentRepository {
  /** Intentos por id. */
  readonly attempts = new Map<string, PaymentAttempt>()
  /** Devoluciones por id. */
  readonly refunds = new Map<string, Refund>()
  /** Eventos que llegaron por `update`. */
  readonly events: NewDomainEvent[] = []

  /** @param orders - Pedidos a sincronizar (`orders.payment_status`), o `null`. */
  constructor(private readonly orders: Pick<OrderPaymentsPort, 'setPaymentStatus'> | null = null) {}

  /** {@inheritDoc PaymentRepository.startAttempt} */
  async startAttempt(
    input: NewPaymentAttempt,
  ): Promise<{ attempt: PaymentAttempt; previous: PaymentAttempt | null }> {
    this.assertUniqueKey(input.idempotencyKey)
    const active = this.activeOf(input.orderId)
    let previous: PaymentAttempt | null = null
    if (active !== null) {
      previous = { ...active, status: 'cancelled', isActive: false, challengeUrl: null }
      this.attempts.set(active.id, previous)
    }
    const attempt = this.build(input, true)
    this.attempts.set(attempt.id, attempt)
    await this.orders?.setPaymentStatus(input.orderId, 'none')
    return { attempt: { ...attempt }, previous }
  }

  /** {@inheritDoc PaymentRepository.recordAttempt} */
  recordAttempt(input: NewPaymentAttempt): Promise<PaymentAttempt> {
    this.assertUniqueKey(input.idempotencyKey)
    const attempt = this.build(input, false)
    this.attempts.set(attempt.id, attempt)
    return Promise.resolve({ ...attempt })
  }

  /** {@inheritDoc PaymentRepository.findById} */
  findById(id: string): Promise<PaymentAttempt | null> {
    return Promise.resolve(this.copy(this.attempts.get(id)))
  }

  /** {@inheritDoc PaymentRepository.findActiveByOrder} */
  findActiveByOrder(orderId: string): Promise<PaymentAttempt | null> {
    return Promise.resolve(this.copy(this.activeOf(orderId) ?? undefined))
  }

  /** {@inheritDoc PaymentRepository.findByProviderPaymentId} */
  findByProviderPaymentId(
    provider: PaymentProvider,
    providerPaymentId: string,
  ): Promise<PaymentAttempt | null> {
    return Promise.resolve(
      this.copy(
        [...this.attempts.values()].find(
          (attempt) =>
            sameProvider(attempt.provider, provider) &&
            attempt.providerPaymentId === providerPaymentId,
        ),
      ),
    )
  }

  /** {@inheritDoc PaymentRepository.findByPreferenceId} */
  findByPreferenceId(
    provider: PaymentProvider,
    preferenceId: string,
  ): Promise<PaymentAttempt | null> {
    return Promise.resolve(
      this.copy(
        [...this.attempts.values()].find(
          (attempt) =>
            sameProvider(attempt.provider, provider) &&
            attempt.providerPreferenceId === preferenceId,
        ),
      ),
    )
  }

  /** {@inheritDoc PaymentRepository.listByOrder} */
  listByOrder(orderId: string): Promise<PaymentAttempt[]> {
    return Promise.resolve(
      [...this.attempts.values()]
        .filter((attempt) => attempt.orderId === orderId)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .map((attempt) => ({ ...attempt })),
    )
  }

  /** {@inheritDoc PaymentRepository.update} */
  async update(
    id: string,
    patch: PaymentAttemptPatch,
    events: readonly NewDomainEvent[] = [],
  ): Promise<PaymentAttempt> {
    const current = this.attempts.get(id)
    if (current === undefined) throw new Error(`No hay un intento ${id}`)
    const next: PaymentAttempt = { ...current, ...patch }
    if (next.isActive && !current.isActive && this.activeOf(current.orderId) !== null) {
      throw new Error('payments_active_per_order_idx: el pedido ya tiene un intento activo')
    }
    if (
      next.providerPaymentId !== null &&
      [...this.attempts.values()].some(
        (attempt) => attempt.id !== id && attempt.providerPaymentId === next.providerPaymentId,
      )
    ) {
      throw new Error('payments_provider_provider_payment_id_key: pago repetido')
    }
    // Solo el intento vigente (el activo, o cualquiera si el pedido no tiene activo) manda en
    // orders.payment_status: un estado tardío de un intento reemplazado no pisa al activo.
    const governs = current.isActive || this.activeOf(current.orderId) === null
    this.attempts.set(id, next)
    this.events.push(...events)
    if (next.status !== current.status && governs)
      await this.orders?.setPaymentStatus(next.orderId, next.status)
    return { ...next }
  }

  /** {@inheritDoc PaymentRepository.createRefund} */
  createRefund(input: NewRefund): Promise<Refund> {
    const refund: Refund = { ...input, providerRefundId: null, status: 'pending', lastError: null }
    this.refunds.set(refund.id, refund)
    return Promise.resolve({ ...refund })
  }

  /** {@inheritDoc PaymentRepository.updateRefund} */
  updateRefund(
    id: string,
    patch: {
      providerRefundId?: string | null
      status?: Refund['status']
      lastError?: string | null
    },
  ): Promise<Refund> {
    const current = this.refunds.get(id)
    if (current === undefined) throw new Error(`No hay una devolución ${id}`)
    const next: Refund = { ...current, ...patch }
    this.refunds.set(id, next)
    return Promise.resolve({ ...next })
  }

  /** {@inheritDoc PaymentRepository.findRefundByPayment} */
  findRefundByPayment(paymentId: string, reason: Refund['reason']): Promise<Refund | null> {
    const refund = [...this.refunds.values()].find(
      (candidate) => candidate.paymentId === paymentId && candidate.reason === reason,
    )
    return Promise.resolve(refund === undefined ? null : { ...refund })
  }

  /**
   * @param orderId - Id del pedido.
   * @returns Los intentos del pedido (copia), del más viejo al más nuevo.
   */
  of(orderId: string): PaymentAttempt[] {
    return [...this.attempts.values()].filter((attempt) => attempt.orderId === orderId)
  }

  private activeOf(orderId: string): PaymentAttempt | null {
    return (
      [...this.attempts.values()].find(
        (attempt) => attempt.orderId === orderId && attempt.isActive,
      ) ?? null
    )
  }

  private assertUniqueKey(key: string): void {
    if ([...this.attempts.values()].some((attempt) => attempt.idempotencyKey === key)) {
      throw new Error('payments_idempotency_key_key: clave repetida')
    }
  }

  private build(input: NewPaymentAttempt, isActive: boolean): PaymentAttempt {
    return {
      ...input,
      provider: 'mercadopago',
      status: 'none',
      providerStatus: null,
      statusDetail: null,
      providerPaymentId: null,
      providerPreferenceId: null,
      initPoint: null,
      challengeUrl: null,
      refundedArs: 0,
      installments: null,
      paymentTypeId: null,
      cardBrand: null,
      cardLastFour: null,
      issuerId: null,
      isActive,
      approvedAt: null,
    }
  }

  private copy(attempt: PaymentAttempt | undefined): PaymentAttempt | null {
    return attempt === undefined ? null : { ...attempt }
  }
}

/** {@link WebhookEventRepository} en memoria, deduplicando por `(provider, eventId)`. */
export class InMemoryWebhookEvents implements WebhookEventRepository {
  /** Notificaciones por id de fila. */
  readonly rows = new Map<string, StoredWebhookEvent & { lastError: string | null }>()

  /** {@inheritDoc WebhookEventRepository.record} */
  record(input: NewWebhookEvent): Promise<{ id: string; duplicate: boolean }> {
    const existing = [...this.rows.values()].find(
      (row) => sameProvider(row.provider, input.provider) && row.eventId === input.eventId,
    )
    if (existing !== undefined) return Promise.resolve({ id: existing.id, duplicate: true })
    const id = newId()
    this.rows.set(id, { ...input, id, processedAt: null, attempts: 0, lastError: null })
    return Promise.resolve({ id, duplicate: false })
  }

  /** {@inheritDoc WebhookEventRepository.findById} */
  findById(id: string): Promise<StoredWebhookEvent | null> {
    const row = this.rows.get(id)
    return Promise.resolve(row === undefined ? null : { ...row })
  }

  /** {@inheritDoc WebhookEventRepository.markProcessed} */
  markProcessed(id: string, at: Date, lastError: string | null): Promise<void> {
    const row = this.rows.get(id)
    if (row !== undefined) this.rows.set(id, { ...row, processedAt: at, lastError })
    return Promise.resolve()
  }
}

/** {@link WebhookQueuePort} que anota los jobs; con `available = false` simula Redis caído. */
export class RecordingWebhookQueue implements WebhookQueuePort {
  /** Ids encolados. */
  readonly jobs: string[] = []
  /** Si la cola acepta jobs. */
  available = true

  /** {@inheritDoc WebhookQueuePort.enqueue} */
  enqueue(eventId: string): Promise<boolean> {
    if (!this.available) return Promise.resolve(false)
    this.jobs.push(eventId)
    return Promise.resolve(true)
  }
}

/** Una llamada a la pasarela de prueba. */
export interface GatewayCall {
  /** Método llamado. */
  method: keyof PaymentGatewayPort
  /** Argumentos. */
  args: unknown[]
}

/**
 * Pasarela programable: cobra con los tokens `sim_` del simulador (mismos titulares y cuotas),
 * guarda los pagos para `getPayment`, anota cada llamada y puede fallar por método.
 */
export class FakeGateway implements PaymentGatewayPort {
  /** Llamadas, en orden. */
  readonly calls: GatewayCall[] = []
  /** Pagos que "tiene" Mercado Pago, por id. */
  readonly payments = new Map<string, ProviderPayment>()
  /** Error a lanzar por método. */
  readonly failures: Partial<Record<keyof PaymentGatewayPort, Error>> = {}
  /** Estado con que responden las devoluciones. */
  refundStatus: RefundResult['status'] = 'approved'
  private sequence = 0

  /** @param clock - Reloj para `approvedAt`. */
  constructor(private readonly clock: Clock) {}

  /**
   * @param method - Método.
   * @returns Los argumentos de cada llamada a ese método.
   */
  callsTo(method: keyof PaymentGatewayPort): unknown[][] {
    return this.calls.filter((call) => call.method === method).map((call) => call.args)
  }

  /**
   * Cambia (o agrega) un pago como si Mercado Pago lo hubiera actualizado.
   *
   * @param payment - Pago.
   */
  setPayment(payment: ProviderPayment): void {
    this.payments.set(payment.providerPaymentId, payment)
  }

  /** {@inheritDoc PaymentGatewayPort.createPreference} */
  createPreference(input: PreferenceInput): Promise<PreferenceResult> {
    this.track('createPreference', [input])
    this.sequence += 1
    const preferenceId = `sim-pref-${String(this.sequence)}`
    return Promise.resolve({
      preferenceId,
      initPoint: `${SIMULATOR_ORIGIN}/api/v1/__simulated/mercadopago/checkout?preference=${preferenceId}`,
    })
  }

  /** {@inheritDoc PaymentGatewayPort.expirePreference} */
  expirePreference(preferenceId: string): Promise<void> {
    this.track('expirePreference', [preferenceId])
    return Promise.resolve()
  }

  /** {@inheritDoc PaymentGatewayPort.createCardPayment} */
  createCardPayment(input: CardChargeInput): Promise<ProviderPayment> {
    this.track('createCardPayment', [input])
    const token = parseSimulatedToken(input.token)
    if (token === null) return Promise.reject(new InvalidCardTokenError())
    const offered = simulatedInstallments(input.order.totalArs, 3, true).map(
      (option) => option.installments,
    )
    if (!offered.includes(input.installments)) {
      return Promise.reject(new InstallmentsNotAvailableError())
    }
    this.sequence += 1
    const providerPaymentId = String(1_000_000_000 + this.sequence)
    const outcome = simulatedOutcome(token.holder)
    const payment: ProviderPayment = {
      providerPaymentId,
      status: outcome.status,
      statusDetail: outcome.statusDetail,
      amountArs: input.order.totalArs,
      refundedArs: 0,
      installments: input.installments,
      paymentTypeId: 'credit_card',
      paymentMethodId: input.paymentMethodId,
      cardLastFour: token.lastFour,
      issuerId: input.issuerId,
      externalReference: input.order.number,
      challengeUrl:
        outcome.statusDetail === 'pending_challenge'
          ? `${SIMULATOR_ORIGIN}/api/v1/__simulated/mercadopago/challenge?payment=${providerPaymentId}`
          : null,
      approvedAt: outcome.status === 'approved' ? this.clock.now() : null,
    }
    this.payments.set(providerPaymentId, payment)
    return Promise.resolve({ ...payment })
  }

  /** {@inheritDoc PaymentGatewayPort.getPayment} */
  getPayment(providerPaymentId: string): Promise<ProviderPayment | null> {
    this.track('getPayment', [providerPaymentId])
    const payment = this.payments.get(providerPaymentId)
    return Promise.resolve(payment === undefined ? null : { ...payment })
  }

  /** {@inheritDoc PaymentGatewayPort.cancelPayment} */
  cancelPayment(providerPaymentId: string): Promise<ProviderPayment | null> {
    this.track('cancelPayment', [providerPaymentId])
    const payment = this.payments.get(providerPaymentId)
    if (payment === undefined) return Promise.resolve(null)
    const cancelled = { ...payment, status: 'cancelled', statusDetail: 'by_collector' }
    this.payments.set(providerPaymentId, cancelled)
    return Promise.resolve({ ...cancelled })
  }

  /** {@inheritDoc PaymentGatewayPort.refundPayment} */
  refundPayment(providerPaymentId: string, idempotencyKey: string): Promise<RefundResult> {
    this.track('refundPayment', [providerPaymentId, idempotencyKey])
    this.sequence += 1
    return Promise.resolve({
      providerRefundId: `refund-${String(this.sequence)}`,
      status: this.refundStatus,
    })
  }

  /** {@inheritDoc PaymentGatewayPort.getInstallments} */
  getInstallments(input: InstallmentsRequest): Promise<InstallmentOption[]> {
    this.track('getInstallments', [input])
    return Promise.resolve(
      simulatedInstallments(
        input.amountArs,
        input.maxWithoutInterest,
        input.paymentTypeId === 'credit_card',
      ),
    )
  }

  private track(method: keyof PaymentGatewayPort, args: unknown[]): void {
    this.calls.push({ method, args })
    const failure = this.failures[method]
    if (failure !== undefined) throw failure
  }
}

/** {@link PaymentsSettings} fijos (modo simulado, 3 cuotas sin interés). */
export class FixedPaymentsSettings implements PaymentsSettings {
  /** {@inheritDoc PaymentsSettings.mode} */
  mode: 'simulated' | 'live' = 'simulated'
  /** {@inheritDoc PaymentsSettings.notificationUrl} */
  notificationUrl: string | null = null
  /** {@inheritDoc PaymentsSettings.storeOrigin} */
  storeOrigin = STORE_ORIGIN
  /** {@inheritDoc PaymentsSettings.statementDescriptor} */
  statementDescriptor = 'GALPON MATES'
  /** {@inheritDoc PaymentsSettings.webhookSecret} */
  webhookSecret: string | null = WEBHOOK_SECRET
  /** Lo que devuelve {@link FixedPaymentsSettings.maxWithoutInterest}. */
  installmentsMax = 3

  /** {@inheritDoc PaymentsSettings.maxWithoutInterest} */
  maxWithoutInterest(): Promise<number> {
    return Promise.resolve(this.installmentsMax)
  }
}

/** {@link PaymentsLogger} que anota los avisos. */
export class RecordingPaymentsLogger implements PaymentsLogger {
  /** Avisos, en orden. */
  readonly warnings: string[] = []

  /** {@inheritDoc PaymentsLogger.warn} */
  warn(message: string): void {
    this.warnings.push(message)
  }
}

/**
 * Todos los casos de uso de pagos cableados con los dobles de este archivo (como lo hace
 * `payments.module.ts` con los adaptadores reales).
 *
 * @returns Los dobles y los casos de uso.
 */
export function createPaymentsHarness() {
  const clock = new FixedClock()
  const orders = new InMemoryOrderPaymentsStub(clock)
  const payments = new InMemoryPaymentRepository(orders)
  const gateway = new FakeGateway(clock)
  const settings = new FixedPaymentsSettings()
  const logger = new RecordingPaymentsLogger()
  const webhookEvents = new InMemoryWebhookEvents()
  const queue = new RecordingWebhookQueue()
  const access = new PaymentOrderAccess(orders, new FixedSecrets(), orders, clock)
  const apply = new ApplyProviderPaymentCommand(payments, orders, gateway, clock, logger)
  const process = new ProcessWebhookEventCommand(webhookEvents, gateway, apply, clock)
  return {
    clock,
    orders,
    payments,
    gateway,
    settings,
    logger,
    webhookEvents,
    queue,
    apply,
    process,
    preference: new CreatePreferenceCommand(access, payments, gateway, settings, clock, logger),
    card: new PayWithCardCommand(access, payments, gateway, apply, settings, clock, logger),
    cancel: new CancelPaymentCommand(access, payments, gateway, logger),
    installments: new GetInstallmentsQuery(access, gateway, settings),
    receive: new ReceiveWebhookCommand(
      settings,
      hmacSha256Hex,
      webhookEvents,
      queue,
      process,
      clock,
    ),
    reconcile: new ReconcilePendingPaymentsCommand(
      orders,
      payments,
      gateway,
      apply,
      orders,
      clock,
      logger,
    ),
    onExpired: new OnOrderExpiredCommand(payments, gateway, logger),
    simulate: new SimulateProviderResultCommand(payments, orders, apply, clock, (payment) => {
      gateway.setPayment(payment)
    }),
  }
}

/** Lo que devuelve {@link createPaymentsHarness}. */
export type PaymentsHarness = ReturnType<typeof createPaymentsHarness>
