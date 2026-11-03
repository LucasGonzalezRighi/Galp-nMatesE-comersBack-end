import { describe, expect, it } from 'vitest'

import {
  createPaymentsHarness,
  ORDER_TOKEN,
  ORDER_TOTAL,
  simToken,
  STORE_ORIGIN,
  type PaymentsHarness,
} from '../../../../test/support/payments'
import { OrderNotFoundError } from '../../orders/domain/orders-errors'
import type { OrderStatus } from '../../orders/domain/order-status'
import {
  InstallmentsNotAvailableError,
  InvalidCardTokenError,
  OrderNotPayableError,
  PaymentGatewayError,
} from '../domain/payments-errors'
import type { ProviderPayment } from '../domain/provider-payment'
import type { CardPaymentInput } from './commands/pay-with-card.command'
import type { OrderAccess } from './order-access'

const MINUTE = 60_000
const KEY_1 = '3f2b8c1e-5d4a-4e7b-9a60-1c2d3e4f5a61'
const KEY_2 = '3f2b8c1e-5d4a-4e7b-9a60-1c2d3e4f5a62'
const KEY_3 = '3f2b8c1e-5d4a-4e7b-9a60-1c2d3e4f5a63'

function cardInput(holder: string, installments = 1): CardPaymentInput {
  return {
    token: simToken(holder),
    paymentMethodId: 'visa',
    issuerId: null,
    installments,
    payer: { email: 'ana@example.com', identification: { type: 'DNI', number: '12345678' } },
  }
}

function setup() {
  const h = createPaymentsHarness()
  const order = h.orders.add()
  const access: OrderAccess = { number: order.number, token: ORDER_TOKEN }
  return { h, order, access }
}

function only<T>(items: readonly T[]): T {
  expect(items).toHaveLength(1)
  const [item] = items
  if (item === undefined) throw new Error('Se esperaba un elemento')
  return item
}

async function everyRoute(h: PaymentsHarness, access: OrderAccess) {
  const results = await Promise.allSettled([
    h.preference.execute(access, KEY_1),
    h.card.execute(access, cardInput('APRO'), KEY_2),
    h.cancel.execute(access),
    h.installments.execute(access, { bin: '450995', paymentTypeId: 'credit_card' }),
  ])
  return results.map((result): unknown =>
    result.status === 'rejected' ? (result.reason as unknown) : null,
  )
}

describe('acceso a las cuatro rutas de pago', () => {
  it.each([
    ['token ajeno', { token: 'otro-token' }],
    ['sin token', { token: null }],
    ['token vacío', { token: '' }],
    ['pedido inexistente', { number: 'GLP-99999' }],
  ])('%s → 404 idéntico', async (_case, override) => {
    const { h, access } = setup()
    const errors = await everyRoute(h, { ...access, ...override })
    for (const error of errors) {
      expect(error).toBeInstanceOf(OrderNotFoundError)
      expect(error).toMatchObject({ status: 404, detail: 'No encontramos ese pedido.' })
    }
    expect(h.payments.attempts.size).toBe(0)
    expect(h.gateway.calls).toEqual([])
  })

  it.each([
    ['expired', 'El pedido venció.'],
    ['paid', 'El pedido ya está pagado.'],
    ['shipped', 'El pedido ya está pagado.'],
    ['cancelled', 'El pedido ya no admite pagos.'],
  ] as const)('pedido %s → 409 order_not_payable "%s"', async (status: OrderStatus, detail) => {
    const h = createPaymentsHarness()
    const order = h.orders.add({ status })
    const errors = await everyRoute(h, { number: order.number, token: ORDER_TOKEN })
    for (const error of errors) {
      expect(error).toBeInstanceOf(OrderNotPayableError)
      expect(error).toMatchObject({
        code: 'order_not_payable',
        status: 409,
        title: 'El pedido no admite un pago nuevo',
        detail,
      })
    }
    expect(h.payments.attempts.size).toBe(0)
  })

  it('un pedido con la reserva cumplida y sin pago vence al leerlo → 409 "El pedido venció."', async () => {
    const { h, order, access } = setup()
    h.clock.advance(30 * MINUTE)
    await expect(h.preference.execute(access, KEY_1)).rejects.toMatchObject({
      code: 'order_not_payable',
      detail: 'El pedido venció.',
    })
    expect(h.orders.get(order.id).status).toBe('expired')
  })
})

describe('CreatePreferenceCommand', () => {
  it('crea la preferencia y deja un intento mp_redirect activo en none', async () => {
    const { h, order, access } = setup()
    const view = await h.preference.execute(access, KEY_1)
    expect(view).toEqual({
      initPoint:
        'http://localhost:3001/api/v1/__simulated/mercadopago/checkout?preference=sim-pref-1',
    })
    const attempt = only(h.payments.of(order.id))
    expect(attempt).toMatchObject({
      method: 'mp_redirect',
      status: 'none',
      isActive: true,
      idempotencyKey: KEY_1,
      amountArs: ORDER_TOTAL,
      providerPreferenceId: 'sim-pref-1',
      initPoint: view.initPoint,
    })
    expect(only(h.gateway.callsTo('createPreference'))).toEqual([
      {
        order: expect.objectContaining({ id: order.id, number: order.number }) as unknown,
        idempotencyKey: KEY_1,
        notificationUrl: null,
        backUrl: `${STORE_ORIGIN}/checkout/resultado?pedido=${order.number}`,
        expiresAt: order.reservedUntil,
        statementDescriptor: 'GALPON MATES',
      },
    ])
    expect(h.orders.get(order.id).paymentStatus).toBe('none')
  })

  it('el intento anterior pending queda cancelled y se cancela en Mercado Pago', async () => {
    const { h, order, access } = setup()
    await h.card.execute(access, cardInput('CONT'), KEY_1)
    const [previous] = h.payments.of(order.id)
    await h.preference.execute(access, KEY_2)
    const attempts = h.payments.of(order.id)
    expect(attempts.map((attempt) => [attempt.method, attempt.status, attempt.isActive])).toEqual([
      ['card', 'cancelled', false],
      ['mp_redirect', 'none', true],
    ])
    expect(h.gateway.callsTo('cancelPayment')).toEqual([[previous?.providerPaymentId]])
    expect(h.orders.get(order.id).paymentStatus).toBe('none')
  })

  it('una preferencia anterior se vence en Mercado Pago', async () => {
    const { h, access } = setup()
    await h.preference.execute(access, KEY_1)
    await h.preference.execute(access, KEY_2)
    expect(h.gateway.callsTo('expirePreference')).toEqual([['sim-pref-1']])
  })

  it('un error de Mercado Pago al cancelar el anterior se avisa y no rompe', async () => {
    const { h, access } = setup()
    await h.preference.execute(access, KEY_1)
    h.gateway.failures.expirePreference = new Error('MP no responde')
    await expect(h.preference.execute(access, KEY_2)).resolves.toHaveProperty('initPoint')
    expect(h.logger.warnings).toHaveLength(1)
    expect(h.logger.warnings[0]).toContain('MP no responde')
  })

  it('si la pasarela falla, el intento queda cancelled e inactivo y sale el 502', async () => {
    const { h, order, access } = setup()
    h.gateway.failures.createPreference = new PaymentGatewayError()
    await expect(h.preference.execute(access, KEY_1)).rejects.toMatchObject({
      code: 'payment_gateway_error',
      status: 502,
    })
    expect(only(h.payments.of(order.id))).toMatchObject({ status: 'cancelled', isActive: false })
    expect(h.orders.get(order.id).paymentStatus).toBe('cancelled')
  })
})

describe('PayWithCardCommand', () => {
  it('APRO → approved, pedido pagado al instante y eventos payment.approved y order.paid', async () => {
    const { h, order, access } = setup()
    const input = cardInput('APRO', 3)
    const result = await h.card.execute(access, input, KEY_1)
    expect(result).toEqual({
      paymentStatus: 'approved',
      statusDetail: 'accredited',
      challenge: null,
    })
    const paid = h.orders.get(order.id)
    expect(paid.status).toBe('paid')
    expect(paid.paymentStatus).toBe('approved')
    expect(paid.history.map((entry) => entry.status)).toEqual(['pending_payment', 'paid'])
    expect(h.orders.paidCount).toBe(1)
    const attempt = only(h.payments.of(order.id))
    expect(attempt).toMatchObject({
      method: 'card',
      status: 'approved',
      providerStatus: 'approved',
      statusDetail: 'accredited',
      isActive: false,
      installments: 3,
      paymentTypeId: 'credit_card',
      cardBrand: 'visa',
      cardLastFour: '3704',
      payerEmail: 'ana@example.com',
      approvedAt: h.clock.now(),
    })
    expect(h.payments.events.map((event) => event.type)).toEqual(['payment.approved'])
    expect(h.payments.events[0]?.payload).toEqual({
      orderId: order.id,
      number: order.number,
      paymentId: attempt.id,
      providerPaymentId: attempt.providerPaymentId,
      amountArs: ORDER_TOTAL,
    })
    expect(h.orders.events).toEqual([
      {
        type: 'order.paid',
        aggregateType: 'order',
        aggregateId: order.number,
        payload: { orderId: order.id, number: order.number, paidAt: h.clock.now().toISOString() },
      },
    ])
    expect(only(h.gateway.callsTo('createCardPayment'))).toEqual([
      {
        order: expect.objectContaining({ id: order.id }) as unknown,
        idempotencyKey: KEY_1,
        token: input.token,
        paymentMethodId: 'visa',
        issuerId: null,
        installments: 3,
        payer: input.payer,
        notificationUrl: null,
        statementDescriptor: 'GALPON MATES',
      },
    ])
  })

  it('CONT → pending y el intento sigue activo', async () => {
    const { h, order, access } = setup()
    await expect(h.card.execute(access, cardInput('CONT'), KEY_1)).resolves.toEqual({
      paymentStatus: 'pending',
      statusDetail: 'pending_contingency',
      challenge: null,
    })
    expect(only(h.payments.of(order.id))).toMatchObject({ status: 'pending', isActive: true })
    expect(h.orders.get(order.id)).toMatchObject({
      status: 'pending_payment',
      paymentStatus: 'pending',
    })
  })

  it('3DS → action_required con el desafío', async () => {
    const { h, order, access } = setup()
    const result = await h.card.execute(access, cardInput('3DS'), KEY_1)
    const attempt = only(h.payments.of(order.id))
    expect(result).toEqual({
      paymentStatus: 'action_required',
      statusDetail: 'pending_challenge',
      challenge: {
        url: `http://localhost:3001/api/v1/__simulated/mercadopago/challenge?payment=${String(attempt.providerPaymentId)}`,
      },
    })
    expect(attempt).toMatchObject({ status: 'action_required', isActive: true })
    expect(attempt.challengeUrl).toBe(result.challenge?.url)
    expect(h.orders.get(order.id).paymentStatus).toBe('action_required')
  })

  it('OTHE → rejected, intento inactivo, evento payment.rejected y el pedido vencible', async () => {
    const { h, order, access } = setup()
    await expect(h.card.execute(access, cardInput('OTHE'), KEY_1)).resolves.toEqual({
      paymentStatus: 'rejected',
      statusDetail: 'cc_rejected_other_reason',
      challenge: null,
    })
    expect(only(h.payments.of(order.id))).toMatchObject({ status: 'rejected', isActive: false })
    expect(h.payments.events.map((event) => [event.type, event.payload.statusDetail])).toEqual([
      ['payment.rejected', 'cc_rejected_other_reason'],
    ])
    expect(h.orders.get(order.id).paymentStatus).toBe('rejected')
    h.clock.advance(30 * MINUTE)
    await expect(h.orders.expireOne(order.id)).resolves.toMatchObject({ status: 'expired' })
  })

  it('token inválido → 422 en token y el intento queda cancelled', async () => {
    const { h, order, access } = setup()
    const error: unknown = await h.card
      .execute(access, { ...cardInput('APRO'), token: '9a8b7c6d5e4f' }, KEY_1)
      .catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(InvalidCardTokenError)
    expect(error).toMatchObject({
      status: 422,
      errors: [{ field: 'token', code: 'invalid_token' }],
    })
    expect(only(h.payments.of(order.id))).toMatchObject({ status: 'cancelled', isActive: false })
    expect(h.orders.get(order.id).paymentStatus).toBe('cancelled')
  })

  it('cuotas que la pasarela no ofrece → 422 en installments', async () => {
    const { h, order, access } = setup()
    await expect(h.card.execute(access, cardInput('APRO', 4), KEY_1)).rejects.toBeInstanceOf(
      InstallmentsNotAvailableError,
    )
    expect(only(h.payments.of(order.id))).toMatchObject({ status: 'cancelled', isActive: false })
    expect(h.orders.get(order.id).status).toBe('pending_payment')
  })
})

describe('Review Focus 1: nunca dos cobros válidos', () => {
  it('APRO y después otro pago con clave nueva → 409 "El pedido ya está pagado."', async () => {
    const { h, access } = setup()
    await h.card.execute(access, cardInput('APRO'), KEY_1)
    await expect(h.card.execute(access, cardInput('APRO'), KEY_2)).rejects.toMatchObject({
      code: 'order_not_payable',
      detail: 'El pedido ya está pagado.',
    })
    await expect(h.preference.execute(access, KEY_3)).rejects.toBeInstanceOf(OrderNotPayableError)
    expect(h.gateway.callsTo('createCardPayment')).toHaveLength(1)
    expect(h.orders.paidCount).toBe(1)
  })

  it('un segundo aprobado que llega igual se devuelve una sola vez y el pedido sigue pagado una vez', async () => {
    const { h, order, access } = setup()
    await h.preference.execute(access, KEY_1)
    await h.card.execute(access, cardInput('APRO'), KEY_2)
    const late: ProviderPayment = {
      providerPaymentId: '2000000001',
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
    }
    await h.apply.execute(late, { attemptId: null, source: 'webhook' })
    await h.apply.execute(late, { attemptId: null, source: 'webhook' })

    const refund = only([...h.payments.refunds.values()])
    const duplicate = h.payments
      .of(order.id)
      .find((attempt) => attempt.providerPaymentId === '2000000001')
    expect(duplicate).toMatchObject({ method: 'mp_redirect', status: 'approved', isActive: false })
    expect(refund).toMatchObject({
      paymentId: duplicate?.id,
      reason: 'duplicate_payment',
      amountArs: ORDER_TOTAL,
      status: 'approved',
      providerRefundId: expect.stringMatching(/^refund-/) as unknown,
      lastError: null,
    })
    expect(refund.idempotencyKey).not.toBe(duplicate?.idempotencyKey)
    expect(h.gateway.callsTo('refundPayment')).toEqual([['2000000001', refund.idempotencyKey]])
    expect(h.orders.paidCount).toBe(1)
    expect(h.orders.get(order.id)).toMatchObject({ status: 'paid', paymentStatus: 'approved' })

    await h.apply.execute(
      { ...late, status: 'refunded', statusDetail: 'refunded', refundedArs: ORDER_TOTAL },
      { attemptId: null, source: 'webhook' },
    )
    expect(h.orders.get(order.id)).toMatchObject({ status: 'paid', paymentStatus: 'approved' })
    expect(h.payments.events.at(-1)).toMatchObject({
      type: 'payment.refunded',
      payload: { paymentId: duplicate?.id, amountArs: ORDER_TOTAL, reason: 'duplicate_payment' },
    })
  })
})

describe('CancelPaymentCommand', () => {
  it('sin intento activo responde igual, y repetirla no hace daño', async () => {
    const { h, order, access } = setup()
    await expect(h.cancel.execute(access)).resolves.toBeUndefined()
    await expect(h.cancel.execute(access)).resolves.toBeUndefined()
    expect(h.payments.attempts.size).toBe(0)
    expect(h.orders.get(order.id).paymentStatus).toBe('none')
  })

  it('cancela la preferencia activa: cancelled, vencida en MP, el pedido conserva la reserva', async () => {
    const { h, order, access } = setup()
    await h.preference.execute(access, KEY_1)
    await h.cancel.execute(access)
    await h.cancel.execute(access)
    expect(only(h.payments.of(order.id))).toMatchObject({ status: 'cancelled', isActive: false })
    expect(h.gateway.callsTo('expirePreference')).toEqual([['sim-pref-1']])
    expect(h.orders.get(order.id)).toMatchObject({
      status: 'pending_payment',
      paymentStatus: 'cancelled',
      reservedUntil: order.reservedUntil,
    })
  })

  it('cancela un pago pendiente en Mercado Pago y deja el pedido vencible', async () => {
    const { h, order, access } = setup()
    await h.card.execute(access, cardInput('3DS'), KEY_1)
    const [attempt] = h.payments.of(order.id)
    h.gateway.failures.cancelPayment = new Error('MP caído')
    await h.cancel.execute(access)
    expect(h.gateway.callsTo('cancelPayment')).toEqual([[attempt?.providerPaymentId]])
    expect(h.payments.of(order.id)[0]).toMatchObject({
      status: 'cancelled',
      isActive: false,
      challengeUrl: null,
    })
    expect(h.logger.warnings).toHaveLength(1)
    h.clock.advance(30 * MINUTE)
    await expect(h.orders.expireOne(order.id)).resolves.not.toBeNull()
  })
})

describe('GetInstallmentsQuery', () => {
  it('crédito: la tabla sobre el total del pedido y el máximo de los ajustes', async () => {
    const { h, order, access } = setup()
    const options = await h.installments.execute(access, {
      bin: '450995',
      paymentTypeId: 'credit_card',
    })
    expect(options.map((option) => [option.installments, option.cftPercent])).toEqual([
      [1, 0],
      [2, 0],
      [3, 0],
      [6, 45.9],
      [12, 45.9],
    ])
    expect(only(h.gateway.callsTo('getInstallments'))).toEqual([
      {
        bin: '450995',
        paymentTypeId: 'credit_card',
        amountArs: order.totalArs,
        maxWithoutInterest: 3,
      },
    ])
  })

  it('débito: una sola opción de 1 pago', async () => {
    const { h, access } = setup()
    const options = await h.installments.execute(access, {
      bin: '45099512',
      paymentTypeId: 'debit_card',
    })
    expect(options).toEqual([
      expect.objectContaining({ installments: 1, totalArs: ORDER_TOTAL, cftPercent: 0 }),
    ])
  })

  it('usa el máximo sin interés de los ajustes', async () => {
    const { h, access } = setup()
    h.settings.installmentsMax = 6
    const options = await h.installments.execute(access, {
      bin: '450995',
      paymentTypeId: 'credit_card',
    })
    expect(options.map((option) => option.installments)).toEqual([1, 2, 3, 4, 5, 6, 12])
  })

  it('rechaza un BIN mal formado', async () => {
    const { h, access } = setup()
    await expect(
      h.installments.execute(access, { bin: '4509', paymentTypeId: 'credit_card' }),
    ).rejects.toThrow('El BIN tiene que tener de 6 a 8 dígitos')
  })
})
