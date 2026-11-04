import { describe, expect, it, vi } from 'vitest'

import {
  createPaymentsHarness,
  ORDER_TOKEN,
  ORDER_TOTAL,
  simToken,
} from '../../../../../test/support/payments'
import type { ProviderPayment } from '../../domain/provider-payment'

const MINUTE = 60_000
const KEY_1 = '0b6f2a52-6f1e-4c8e-9d0a-7b1c2d3e4f01'
const KEY_2 = '0b6f2a52-6f1e-4c8e-9d0a-7b1c2d3e4f02'

function setup() {
  const h = createPaymentsHarness()
  const order = h.orders.add()
  const access = { number: order.number, token: ORDER_TOKEN }
  function payment(overrides: Partial<ProviderPayment> = {}): ProviderPayment {
    return {
      providerPaymentId: '3000000001',
      status: 'approved',
      statusDetail: 'accredited',
      amountArs: ORDER_TOTAL,
      refundedArs: 0,
      installments: 1,
      paymentTypeId: 'account_money',
      paymentMethodId: 'account_money',
      cardLastFour: null,
      issuerId: null,
      externalReference: order.number,
      challengeUrl: null,
      approvedAt: h.clock.now(),
      ...overrides,
    }
  }
  async function payByCard(holder: string) {
    await h.card.execute(
      access,
      {
        token: simToken(holder),
        paymentMethodId: 'visa',
        issuerId: null,
        installments: 1,
        payer: { email: 'ana@example.com', identification: { type: 'DNI', number: '12345678' } },
      },
      KEY_1,
    )
    const [attempt] = h.payments.of(order.id)
    const stored = h.gateway.payments.get(attempt?.providerPaymentId ?? '')
    if (attempt === undefined || stored === undefined) throw new Error('No se creó el pago')
    return { attempt, stored }
  }
  return { h, order, access, payment, payByCard }
}

const WEBHOOK = { attemptId: null, source: 'webhook' } as const

describe('ApplyProviderPaymentCommand · Review Focus 2: notificaciones repetidas y desordenadas', () => {
  it('un pending que llega después del approved del mismo pago no cambia nada', async () => {
    const { h, order, payByCard } = setup()
    const { attempt, stored } = await payByCard('APRO')
    const result = await h.apply.execute(
      { ...stored, status: 'in_process', statusDetail: 'pending_contingency' },
      WEBHOOK,
    )
    expect(result).toMatchObject({ id: attempt.id, status: 'approved' })
    expect(h.payments.of(order.id)[0]).toMatchObject({
      status: 'approved',
      statusDetail: 'accredited',
    })
    expect(h.orders.get(order.id)).toMatchObject({ status: 'paid', paymentStatus: 'approved' })
    expect(h.orders.paidCount).toBe(1)
    expect(h.payments.events.map((event) => event.type)).toEqual(['payment.approved'])
  })

  it('la respuesta inmediata y el webhook del mismo pago en paralelo confirman una sola vez', async () => {
    const { h, order, payByCard } = setup()
    const { attempt, stored } = await payByCard('CONT')
    const approved = { ...stored, status: 'approved', statusDetail: 'accredited' }
    await Promise.all([
      h.apply.execute(approved, WEBHOOK),
      h.apply.execute(approved, { attemptId: attempt.id, source: 'reconcile' }),
    ])
    expect(h.orders.paidCount).toBe(1)
    expect(h.payments.refunds.size).toBe(0)
    expect(h.orders.get(order.id).status).toBe('paid')
  })

  it('approved después de expired → devolución late_approval y el pedido sigue expired', async () => {
    const { h, order, access, payment } = setup()
    await h.preference.execute(access, KEY_1)
    h.clock.advance(30 * MINUTE)
    await h.orders.expireOne(order.id)
    await h.onExpired.execute(order.id)
    await h.apply.execute(payment(), WEBHOOK)
    await h.apply.execute(payment(), WEBHOOK)
    expect(h.orders.get(order.id).status).toBe('expired')
    expect(h.orders.paidCount).toBe(0)
    expect([...h.payments.refunds.values()]).toEqual([
      expect.objectContaining({
        reason: 'late_approval',
        status: 'approved',
        amountArs: ORDER_TOTAL,
      }),
    ])
    expect(h.gateway.callsTo('refundPayment')).toHaveLength(1)
  })

  it('markPaid falla una vez después de guardar el intento: el reintento paga el pedido', async () => {
    const { h, order, access, payment } = setup()
    await h.preference.execute(access, KEY_1)
    vi.spyOn(h.orders, 'markPaid').mockRejectedValueOnce(new Error('conexión caída'))
    await expect(h.apply.execute(payment(), WEBHOOK)).rejects.toThrow('conexión caída')
    expect(h.payments.of(order.id)[0]).toMatchObject({ status: 'approved' })
    expect(h.orders.get(order.id)).toMatchObject({
      status: 'pending_payment',
      paymentStatus: 'approved',
    })
    await h.apply.execute(payment(), WEBHOOK)
    await h.apply.execute(payment(), WEBHOOK)
    expect(h.orders.get(order.id)).toMatchObject({ status: 'paid', paymentStatus: 'approved' })
    expect(h.orders.paidCount).toBe(1)
    expect(h.payments.events.map((event) => event.type)).toEqual(['payment.approved'])
    expect(h.orders.events.map((event) => event.type)).toEqual(['order.paid', 'storefront.stale'])
    expect(h.payments.refunds.size).toBe(0)
  })

  it('un aprobado parcial repetido no cambia nada y no devuelve', async () => {
    const { h, order, access, payment } = setup()
    await h.preference.execute(access, KEY_1)
    const partial = payment({ providerPaymentId: '4000000001', amountArs: 30000 })
    await h.apply.execute(partial, WEBHOOK)
    await h.apply.execute(partial, WEBHOOK)
    expect(h.orders.get(order.id)).toMatchObject({
      status: 'pending_payment',
      paymentStatus: 'pending',
    })
    expect(h.payments.refunds.size).toBe(0)
  })

  it('la devolución tardía se corta antes de crearse: el reintento la hace una sola vez', async () => {
    const { h, order, access, payment } = setup()
    await h.preference.execute(access, KEY_1)
    h.clock.advance(30 * MINUTE)
    await h.orders.expireOne(order.id)
    await h.onExpired.execute(order.id)
    vi.spyOn(h.payments, 'createRefund').mockRejectedValueOnce(new Error('timeout'))
    await expect(h.apply.execute(payment(), WEBHOOK)).rejects.toThrow('timeout')
    expect(h.payments.of(order.id).at(-1)).toMatchObject({ status: 'approved' })
    expect(h.payments.refunds.size).toBe(0)
    await h.apply.execute(payment(), WEBHOOK)
    await h.apply.execute(payment(), WEBHOOK)
    expect([...h.payments.refunds.values()]).toEqual([
      expect.objectContaining({ reason: 'late_approval', status: 'approved' }),
    ])
    expect(h.gateway.callsTo('refundPayment')).toHaveLength(1)
    expect(h.orders.get(order.id).status).toBe('expired')
  })

  it('repetir el aprobado del que pagó o el del duplicado no devuelve al que sí pagó', async () => {
    const { h, order, payByCard, payment } = setup()
    const { stored } = await payByCard('APRO')
    const duplicate = payment({ providerPaymentId: '3000000009' })
    await h.apply.execute(duplicate, WEBHOOK)
    await h.apply.execute(duplicate, WEBHOOK)
    await h.apply.execute(stored, WEBHOOK)
    await h.apply.execute(stored, WEBHOOK)
    expect([...h.payments.refunds.values()]).toEqual([
      expect.objectContaining({ reason: 'duplicate_payment', amountArs: ORDER_TOTAL }),
    ])
    expect(h.gateway.callsTo('refundPayment')).toEqual([['3000000009', expect.any(String)]])
    expect(h.orders.get(order.id)).toMatchObject({ status: 'paid', paymentStatus: 'approved' })
    expect(h.orders.paidCount).toBe(1)
  })

  it('el pago que llega por webhook antes que la respuesta de la tarjeta se registra una vez y no se devuelve', async () => {
    const { h, order, payment } = setup()
    const { attempt: inFlight } = await h.payments.startAttempt({
      id: '0190f0aa-0000-7000-8000-000000000001',
      orderId: order.id,
      method: 'card',
      amountArs: ORDER_TOTAL,
      idempotencyKey: KEY_2,
      payerEmail: 'ana@example.com',
      createdAt: h.clock.now(),
    })
    const charged = payment({ paymentTypeId: 'credit_card', paymentMethodId: 'visa' })
    await h.apply.execute(charged, WEBHOOK)
    const result = await h.apply.execute(charged, { attemptId: inFlight.id, source: 'card' })
    expect(result?.providerPaymentId).toBe(charged.providerPaymentId)
    expect(h.orders.paidCount).toBe(1)
    expect(h.payments.refunds.size).toBe(0)
    expect(h.gateway.callsTo('refundPayment')).toEqual([])
  })
})

describe('ApplyProviderPaymentCommand · estados (Ruling B-39)', () => {
  it('refunded del pago que pagó → pedido refunded, payment.refunded manual', async () => {
    const { h, order, payByCard } = setup()
    const { attempt, stored } = await payByCard('APRO')
    await h.apply.execute(
      { ...stored, status: 'refunded', statusDetail: 'refunded', refundedArs: ORDER_TOTAL },
      WEBHOOK,
    )
    expect(h.orders.get(order.id)).toMatchObject({ status: 'refunded', paymentStatus: 'refunded' })
    expect(h.orders.get(order.id).history.map((entry) => entry.status)).toEqual([
      'pending_payment',
      'paid',
      'refunded',
    ])
    expect(h.payments.events.at(-1)).toEqual({
      type: 'payment.refunded',
      aggregateType: 'payment',
      aggregateId: attempt.id,
      payload: {
        orderId: order.id,
        number: order.number,
        paymentId: attempt.id,
        amountArs: ORDER_TOTAL,
        reason: 'manual',
      },
    })
  })

  it('partially_refunded, in_dispute y charged_back solo cambian payment_status', async () => {
    const { h, order, payByCard } = setup()
    const { stored } = await payByCard('APRO')
    await h.apply.execute({ ...stored, refundedArs: 1000 }, WEBHOOK)
    expect(h.orders.get(order.id)).toMatchObject({
      status: 'paid',
      paymentStatus: 'partially_refunded',
    })
    expect(h.payments.of(order.id)[0]?.refundedArs).toBe(1000)
    await h.apply.execute({ ...stored, status: 'in_mediation', statusDetail: null }, WEBHOOK)
    expect(h.orders.get(order.id)).toMatchObject({ status: 'paid', paymentStatus: 'in_dispute' })
    await h.apply.execute({ ...stored, status: 'charged_back', statusDetail: 'settled' }, WEBHOOK)
    expect(h.orders.get(order.id)).toMatchObject({ status: 'paid', paymentStatus: 'charged_back' })
    await h.apply.execute(stored, WEBHOOK)
    expect(h.orders.get(order.id).paymentStatus).toBe('charged_back')
  })

  it('Checkout Pro dividido: un aprobado parcial deja el pedido pending_payment con pago pending', async () => {
    const { h, order, access, payment } = setup()
    await h.preference.execute(access, KEY_1)
    await h.apply.execute(payment({ providerPaymentId: '4000000001', amountArs: 30000 }), WEBHOOK)
    expect(h.orders.get(order.id)).toMatchObject({
      status: 'pending_payment',
      paymentStatus: 'pending',
    })
    expect(h.payments.of(order.id)[0]).toMatchObject({
      method: 'mp_redirect',
      providerPaymentId: '4000000001',
      status: 'approved',
      amountArs: 30000,
    })
    await h.apply.execute(
      payment({ providerPaymentId: '4000000002', amountArs: ORDER_TOTAL - 30000 }),
      WEBHOOK,
    )
    expect(h.orders.get(order.id)).toMatchObject({ status: 'paid', paymentStatus: 'approved' })
    expect(h.orders.paidCount).toBe(1)
    expect(h.payments.refunds.size).toBe(0)
  })

  it('un rechazo tardío de un intento ya reemplazado no pisa el payment_status del activo (Ruling B-45)', async () => {
    const { h, order, access, payByCard } = setup()
    const { stored } = await payByCard('CONT')
    await h.preference.execute(access, KEY_2)
    expect(h.orders.get(order.id).paymentStatus).toBe('none')
    await h.apply.execute(
      { ...stored, status: 'rejected', statusDetail: 'cc_rejected_other_reason' },
      WEBHOOK,
    )
    expect(h.payments.of(order.id).map((attempt) => [attempt.method, attempt.status])).toEqual([
      ['card', 'rejected'],
      ['mp_redirect', 'none'],
    ])
    expect(h.orders.get(order.id)).toMatchObject({
      status: 'pending_payment',
      paymentStatus: 'none',
    })
  })

  it('un pago sin intento propio se registra como mp_redirect inactivo y paga el pedido', async () => {
    const { h, order, payment } = setup()
    const attempt = await h.apply.execute(payment(), WEBHOOK)
    expect(attempt).toMatchObject({
      orderId: order.id,
      method: 'mp_redirect',
      status: 'approved',
      isActive: false,
    })
    expect(h.orders.get(order.id).status).toBe('paid')
  })

  it('un pago de un pedido que no existe se ignora con un aviso', async () => {
    const { h, payment } = setup()
    await expect(
      h.apply.execute(payment({ externalReference: 'GLP-99999' }), WEBHOOK),
    ).resolves.toBeNull()
    await expect(h.apply.execute(payment({ externalReference: null }), WEBHOOK)).resolves.toBeNull()
    expect(h.payments.attempts.size).toBe(0)
    expect(h.logger.warnings).toHaveLength(2)
  })

  it('un estado desconocido de Mercado Pago queda pending con un aviso', async () => {
    const { h, order, payByCard } = setup()
    const { stored } = await payByCard('CONT')
    await h.apply.execute({ ...stored, status: 'algo_nuevo' }, WEBHOOK)
    expect(h.payments.of(order.id)[0]).toMatchObject({
      status: 'pending',
      providerStatus: 'algo_nuevo',
    })
    expect(h.logger.warnings.join('\n')).toContain('algo_nuevo')
  })

  it('si la devolución falla queda failed con el error, se avisa y no se relanza', async () => {
    const { h, payByCard, payment } = setup()
    await payByCard('APRO')
    h.gateway.failures.refundPayment = new Error('MP caído')
    await expect(h.apply.execute(payment(), WEBHOOK)).resolves.not.toBeNull()
    expect([...h.payments.refunds.values()]).toEqual([
      expect.objectContaining({
        reason: 'duplicate_payment',
        status: 'failed',
        lastError: 'MP caído',
        providerRefundId: null,
      }),
    ])
    expect(h.logger.warnings.join('\n')).toContain('MP caído')
  })

  it('rechaza un pago sin id', async () => {
    const { h, payment } = setup()
    await expect(h.apply.execute(payment({ providerPaymentId: ' ' }), WEBHOOK)).rejects.toThrow(
      'El pago de la pasarela necesita un id',
    )
  })
})
