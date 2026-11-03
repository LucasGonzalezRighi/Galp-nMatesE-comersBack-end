import { describe, expect, it } from 'vitest'

import {
  createPaymentsHarness,
  ORDER_TOKEN,
  signWebhook,
  simToken,
} from '../../../../test/support/payments'
import {
  IntentNotActiveError,
  InvalidSignatureError,
  PaymentAttemptNotFoundError,
} from '../domain/payments-errors'
import type { IncomingWebhook } from './commands/receive-webhook.command'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const KEY_1 = '7c9e6679-7425-40de-944b-e07fc1f90a01'
const KEY_2 = '7c9e6679-7425-40de-944b-e07fc1f90a02'

function setup() {
  const h = createPaymentsHarness()
  const order = h.orders.add()
  const access = { number: order.number, token: ORDER_TOKEN }
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
    const attempt = h.payments.of(order.id).at(-1)
    const stored = h.gateway.payments.get(attempt?.providerPaymentId ?? '')
    if (attempt === undefined || stored === undefined) throw new Error('No se creó el pago')
    return { attempt, stored }
  }
  return { h, order, access, payByCard }
}

function webhook(dataId: string, overrides: Partial<IncomingWebhook> = {}): IncomingWebhook {
  const requestId = overrides.requestId === undefined ? 'req-1' : overrides.requestId
  return {
    signatureHeader: signWebhook({ dataId, requestId }),
    requestId,
    dataIdQuery: dataId,
    topicQuery: null,
    body: { id: 12345, type: 'payment', action: 'payment.updated', data: { id: dataId } },
    ...overrides,
  }
}

describe('ReceiveWebhookCommand', () => {
  it('firma válida → registered, evento guardado y encolado', async () => {
    const { h } = setup()
    await expect(h.receive.execute(webhook('1234567890'))).resolves.toBe('registered')
    const [row] = [...h.webhookEvents.rows.values()]
    expect(row).toMatchObject({
      provider: 'mercadopago',
      eventId: '12345',
      type: 'payment',
      action: 'payment.updated',
      resourceId: '1234567890',
      signatureValid: true,
      payload: {
        id: 12345,
        type: 'payment',
        action: 'payment.updated',
        data: { id: '1234567890' },
      },
      receivedAt: h.clock.now(),
      processedAt: null,
    })
    expect(h.queue.jobs).toEqual([row?.id])
  })

  it('con la cola caída lo procesa en línea antes de responder', async () => {
    const { h, order, payByCard } = setup()
    const { stored } = await payByCard('CONT')
    h.gateway.setPayment({ ...stored, status: 'approved', statusDetail: 'accredited' })
    h.queue.available = false
    await expect(h.receive.execute(webhook(stored.providerPaymentId))).resolves.toBe('registered')
    expect(h.queue.jobs).toEqual([])
    expect([...h.webhookEvents.rows.values()][0]).toMatchObject({
      processedAt: h.clock.now(),
      lastError: null,
    })
    expect(h.orders.get(order.id).status).toBe('paid')
  })

  it('el mismo evento dos veces → una sola fila y un solo job', async () => {
    const { h } = setup()
    await h.receive.execute(webhook('1'))
    await expect(h.receive.execute(webhook('1'))).resolves.toBe('duplicate')
    expect(h.webhookEvents.rows.size).toBe(1)
    expect(h.queue.jobs).toHaveLength(1)
  })

  it('un duplicado de un evento sin procesar se reprocesa (la cola y el procesado en línea habían fallado)', async () => {
    const { h, order, payByCard } = setup()
    const { stored } = await payByCard('CONT')
    h.gateway.setPayment({ ...stored, status: 'approved', statusDetail: 'accredited' })
    h.queue.available = false
    h.gateway.failures.getPayment = new Error('MP caído')
    await expect(h.receive.execute(webhook(stored.providerPaymentId))).rejects.toThrow('MP caído')
    const [row] = [...h.webhookEvents.rows.values()]
    expect(row?.processedAt).toBeNull()
    expect(h.orders.get(order.id).status).toBe('pending_payment')
    delete h.gateway.failures.getPayment
    h.queue.available = true
    await expect(h.receive.execute(webhook(stored.providerPaymentId))).resolves.toBe('duplicate')
    expect(h.webhookEvents.rows.size).toBe(1)
    expect(h.queue.jobs).toEqual([row?.id])
  })

  it('un duplicado de un evento sin procesar con la cola caída lo procesa en línea', async () => {
    const { h, order, payByCard } = setup()
    const { stored } = await payByCard('CONT')
    h.gateway.setPayment({ ...stored, status: 'approved', statusDetail: 'accredited' })
    h.queue.available = false
    h.gateway.failures.getPayment = new Error('MP caído')
    await expect(h.receive.execute(webhook(stored.providerPaymentId))).rejects.toThrow('MP caído')
    delete h.gateway.failures.getPayment
    await expect(h.receive.execute(webhook(stored.providerPaymentId))).resolves.toBe('duplicate')
    expect([...h.webhookEvents.rows.values()][0]?.processedAt).toEqual(h.clock.now())
    expect(h.orders.get(order.id).status).toBe('paid')
  })

  it('un duplicado de un evento ya procesado no se vuelve a encolar ni a procesar', async () => {
    const { h, payByCard } = setup()
    const { stored } = await payByCard('CONT')
    await h.receive.execute(webhook(stored.providerPaymentId))
    const [row] = [...h.webhookEvents.rows.values()]
    await h.process.execute(row?.id ?? '')
    const lookups = h.gateway.callsTo('getPayment').length
    h.queue.available = false
    await expect(h.receive.execute(webhook(stored.providerPaymentId))).resolves.toBe('duplicate')
    expect(h.gateway.callsTo('getPayment')).toHaveLength(lookups)
    expect(h.queue.jobs).toEqual([row?.id])
  })

  it('sin id en el cuerpo deduplica por x-request-id', async () => {
    const { h } = setup()
    const input = webhook('1', { body: { type: 'payment', data: { id: '1' } } })
    await h.receive.execute(input)
    await expect(h.receive.execute(input)).resolves.toBe('duplicate')
    expect([...h.webhookEvents.rows.values()][0]?.eventId).toBe('req-1')
  })

  it('data.id con mayúsculas se firma en minúsculas', async () => {
    const { h } = setup()
    await expect(h.receive.execute(webhook('ABC123'))).resolves.toBe('registered')
  })

  it('formato IPN (?topic=…&id=…, sin x-signature) → ignored sin registrar nada', async () => {
    const { h } = setup()
    const ipn = webhook('1', { signatureHeader: null, topicQuery: 'payment', dataIdQuery: null })
    await expect(h.receive.execute(ipn)).resolves.toBe('ignored')
    expect(h.webhookEvents.rows.size).toBe(0)
  })

  it('un cuerpo sin type o sin data.id → ignored', async () => {
    const { h } = setup()
    await expect(h.receive.execute(webhook('1', { body: { type: 'payment' } }))).resolves.toBe(
      'ignored',
    )
    await expect(h.receive.execute(webhook('1', { body: { data: { id: '1' } } }))).resolves.toBe(
      'ignored',
    )
    await expect(h.receive.execute(webhook('1', { body: 'texto' }))).resolves.toBe('ignored')
    expect(h.webhookEvents.rows.size).toBe(0)
  })

  it.each([
    ['v1 cambiado', { signatureHeader: 'ts=1704908010,v1=0000' }],
    ['sin ts', { signatureHeader: 'v1=abc' }],
    ['sin cabecera', { signatureHeader: null }],
    [
      'firmado con otro secreto',
      { signatureHeader: signWebhook({ dataId: '1', requestId: 'req-1', secret: 'otro' }) },
    ],
    ['otro data.id', { dataIdQuery: '2' }],
  ])('%s → InvalidSignatureError sin filas ni jobs', async (_case, override) => {
    const { h } = setup()
    await expect(h.receive.execute(webhook('1', override))).rejects.toBeInstanceOf(
      InvalidSignatureError,
    )
    expect(h.webhookEvents.rows.size).toBe(0)
    expect(h.queue.jobs).toEqual([])
  })

  it('sin secreto configurado → InvalidSignatureError siempre', async () => {
    const { h } = setup()
    h.settings.webhookSecret = null
    await expect(h.receive.execute(webhook('1'))).rejects.toBeInstanceOf(InvalidSignatureError)
    expect(h.webhookEvents.rows.size).toBe(0)
  })
})

describe('ProcessWebhookEventCommand', () => {
  it('un tipo que no es payment se cierra sin consultar la pasarela', async () => {
    const { h } = setup()
    await h.receive.execute(
      webhook('1', { body: { id: 9, type: 'merchant_order', data: { id: '1' } } }),
    )
    const [row] = [...h.webhookEvents.rows.values()]
    await h.process.execute(row?.id ?? '')
    expect(h.webhookEvents.rows.get(row?.id ?? '')).toMatchObject({
      processedAt: h.clock.now(),
      lastError: null,
    })
    expect(h.gateway.callsTo('getPayment')).toEqual([])
  })

  it('un pago que Mercado Pago no tiene se cierra con last_error', async () => {
    const { h } = setup()
    await h.receive.execute(webhook('555'))
    const [row] = [...h.webhookEvents.rows.values()]
    await h.process.execute(row?.id ?? '')
    await h.process.execute(row?.id ?? '')
    expect(h.webhookEvents.rows.get(row?.id ?? '')).toMatchObject({
      processedAt: h.clock.now(),
      lastError: 'Mercado Pago no tiene el pago 555.',
    })
    expect(h.gateway.callsTo('getPayment')).toEqual([['555']])
  })

  it('un pago que existe se aplica', async () => {
    const { h, order, payByCard } = setup()
    const { stored } = await payByCard('CONT')
    h.gateway.setPayment({ ...stored, status: 'approved', statusDetail: 'accredited' })
    await h.receive.execute(webhook(stored.providerPaymentId))
    await h.process.execute(h.queue.jobs[0] ?? '')
    expect(h.orders.get(order.id).status).toBe('paid')
  })

  it('un id que no existe no hace nada', async () => {
    const { h } = setup()
    await expect(h.process.execute('no-existe')).resolves.toBeUndefined()
  })
})

describe('ReprocessWebhookEventsCommand', () => {
  async function received(h: ReturnType<typeof setup>['h'], dataId: string, eventId: number) {
    await h.receive.execute(
      webhook(dataId, {
        requestId: `req-${String(eventId)}`,
        signatureHeader: signWebhook({ dataId, requestId: `req-${String(eventId)}` }),
        body: { id: eventId, type: 'payment', action: 'payment.updated', data: { id: dataId } },
      }),
    )
  }

  it('procesa en línea las notificaciones sin procesar de más de 5 minutos', async () => {
    const { h, order, payByCard } = setup()
    const { stored } = await payByCard('CONT')
    h.gateway.setPayment({ ...stored, status: 'approved', statusDetail: 'accredited' })
    await received(h, stored.providerPaymentId, 1)
    h.clock.advance(4 * MINUTE)
    await expect(h.reprocess.execute()).resolves.toEqual({ processed: 0, failed: 0 })
    expect(h.orders.get(order.id).status).toBe('pending_payment')
    h.clock.advance(2 * MINUTE)
    await expect(h.reprocess.execute()).resolves.toEqual({ processed: 1, failed: 0 })
    expect(h.orders.get(order.id).status).toBe('paid')
    expect([...h.webhookEvents.rows.values()][0]?.processedAt).toEqual(h.clock.now())
    await expect(h.reprocess.execute()).resolves.toEqual({ processed: 0, failed: 0 })
  })

  it('no retoma las notificaciones de más de 6 horas', async () => {
    const { h, payByCard } = setup()
    const { stored } = await payByCard('CONT')
    await received(h, stored.providerPaymentId, 1)
    h.clock.advance(6 * HOUR + MINUTE)
    await expect(h.reprocess.execute()).resolves.toEqual({ processed: 0, failed: 0 })
  })

  it('aísla el fallo de una notificación y avisa', async () => {
    const { h, payByCard } = setup()
    const { stored } = await payByCard('CONT')
    await received(h, stored.providerPaymentId, 1)
    h.gateway.failures.getPayment = new Error('MP caído')
    h.clock.advance(6 * MINUTE)
    await expect(h.reprocess.execute()).resolves.toEqual({ processed: 0, failed: 1 })
    expect(h.logger.warnings.join('\n')).toContain('MP caído')
    expect([...h.webhookEvents.rows.values()][0]?.processedAt).toBeNull()
  })

  it('valida el límite', async () => {
    const { h } = setup()
    await expect(h.reprocess.execute(0)).rejects.toThrow(
      'El máximo de notificaciones a reprocesar tiene que ser un entero positivo (llegó 0)',
    )
  })
})

describe('ReconcilePendingPaymentsCommand (Ruling B-42)', () => {
  it('un pending que Mercado Pago ya aprobó queda pagado', async () => {
    const { h, order, payByCard } = setup()
    const { stored } = await payByCard('CONT')
    h.gateway.setPayment({ ...stored, status: 'approved', statusDetail: 'accredited' })
    h.clock.advance(40 * MINUTE)
    await expect(h.reconcile.execute()).resolves.toEqual({ reconciled: 1, expired: 0, failed: 0 })
    expect(h.orders.get(order.id).status).toBe('paid')
  })

  it('un pending que sigue pendiente no cambia', async () => {
    const { h, order, payByCard } = setup()
    await payByCard('3DS')
    h.clock.advance(40 * MINUTE)
    await expect(h.reconcile.execute()).resolves.toEqual({ reconciled: 1, expired: 0, failed: 0 })
    expect(h.orders.get(order.id)).toMatchObject({
      status: 'pending_payment',
      paymentStatus: 'action_required',
    })
    expect(h.gateway.callsTo('cancelPayment')).toEqual([])
  })

  it('antes de 10 minutos de vencida la reserva no se consulta', async () => {
    const { h, payByCard } = setup()
    await payByCard('CONT')
    h.clock.advance(39 * MINUTE)
    await expect(h.reconcile.execute()).resolves.toEqual({ reconciled: 0, expired: 0, failed: 0 })
    expect(h.gateway.callsTo('getPayment')).toEqual([])
  })

  it('un pending con más de 48 h se cancela en Mercado Pago y el pedido vence en la misma pasada', async () => {
    const { h, order, payByCard } = setup()
    const { attempt } = await payByCard('CONT')
    h.clock.advance(30 * MINUTE + 48 * HOUR + MINUTE)
    await expect(h.reconcile.execute()).resolves.toEqual({ reconciled: 1, expired: 1, failed: 0 })
    expect(h.gateway.callsTo('cancelPayment')).toEqual([[attempt.providerPaymentId]])
    expect(h.payments.of(order.id)[0]).toMatchObject({ status: 'cancelled', isActive: false })
    expect(h.orders.get(order.id).status).toBe('expired')
  })

  it('un pending que Mercado Pago rechazó deja el pedido vencido en la misma pasada', async () => {
    const { h, order, payByCard } = setup()
    const { stored } = await payByCard('CONT')
    h.gateway.setPayment({ ...stored, status: 'rejected', statusDetail: 'cc_rejected_high_risk' })
    h.clock.advance(40 * MINUTE)
    await expect(h.reconcile.execute()).resolves.toEqual({ reconciled: 1, expired: 1, failed: 0 })
    expect(h.orders.get(order.id).status).toBe('expired')
  })

  describe('aprobado parcial de un Checkout Pro dividido (cierre del pedido)', () => {
    async function partiallyPaid() {
      const { h, order, access } = setup()
      await h.preference.execute(access, KEY_1)
      const partial = {
        providerPaymentId: '4000000001',
        status: 'approved',
        statusDetail: 'accredited',
        amountArs: 30000,
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
      await h.apply.execute(partial, { attemptId: null, source: 'webhook' })
      return { h, order }
    }

    it('antes de las 48 h no se devuelve ni se vence', async () => {
      const { h, order } = await partiallyPaid()
      h.clock.advance(40 * MINUTE)
      await expect(h.reconcile.execute()).resolves.toEqual({
        reconciled: 1,
        expired: 0,
        failed: 0,
      })
      expect(h.gateway.callsTo('refundPayment')).toEqual([])
      expect(h.orders.get(order.id)).toMatchObject({
        status: 'pending_payment',
        paymentStatus: 'pending',
      })
    })

    it('a las 48 h se devuelve lo cobrado (late_approval) y el pedido vence en la misma pasada', async () => {
      const { h, order } = await partiallyPaid()
      h.clock.advance(30 * MINUTE + 48 * HOUR + MINUTE)
      await expect(h.reconcile.execute()).resolves.toEqual({
        reconciled: 1,
        expired: 1,
        failed: 0,
      })
      expect([...h.payments.refunds.values()]).toEqual([
        expect.objectContaining({ reason: 'late_approval', amountArs: 30000, status: 'approved' }),
      ])
      expect(h.gateway.callsTo('refundPayment')).toEqual([['4000000001', expect.any(String)]])
      expect(h.orders.get(order.id).status).toBe('expired')
      await expect(h.reconcile.execute()).resolves.toEqual({
        reconciled: 0,
        expired: 0,
        failed: 0,
      })
      expect(h.gateway.callsTo('refundPayment')).toHaveLength(1)
    })

    it('si la devolución falla queda failed, se avisa y el pedido vence igual', async () => {
      const { h, order } = await partiallyPaid()
      h.gateway.failures.refundPayment = new Error('MP caído')
      h.clock.advance(30 * MINUTE + 48 * HOUR + MINUTE)
      await expect(h.reconcile.execute()).resolves.toEqual({
        reconciled: 1,
        expired: 1,
        failed: 0,
      })
      expect([...h.payments.refunds.values()]).toEqual([
        expect.objectContaining({ reason: 'late_approval', status: 'failed' }),
      ])
      expect(h.logger.warnings.join('\n')).toContain('Devolvelo desde Mercado Pago')
      expect(h.orders.get(order.id).status).toBe('expired')
    })
  })

  it('aísla el fallo de un pedido', async () => {
    const { h, payByCard } = setup()
    await payByCard('CONT')
    h.gateway.failures.getPayment = new Error('MP caído')
    h.clock.advance(40 * MINUTE)
    await expect(h.reconcile.execute()).resolves.toEqual({ reconciled: 0, expired: 0, failed: 1 })
    expect(h.logger.warnings.join('\n')).toContain('MP caído')
  })

  it('valida el límite', async () => {
    const { h } = setup()
    await expect(h.reconcile.execute(0)).rejects.toThrow(
      'El máximo de pedidos a conciliar tiene que ser un entero positivo (llegó 0)',
    )
  })
})

describe('OnOrderExpiredCommand', () => {
  it('cancela el intento activo y vence la preferencia en Mercado Pago', async () => {
    const { h, order, access } = setup()
    await h.preference.execute(access, KEY_1)
    await h.onExpired.execute(order.id)
    expect(h.payments.of(order.id)[0]).toMatchObject({ status: 'cancelled', isActive: false })
    expect(h.gateway.callsTo('expirePreference')).toEqual([['sim-pref-1']])
  })

  it('sin intento activo no hace nada', async () => {
    const { h, order } = setup()
    await h.onExpired.execute(order.id)
    expect(h.gateway.calls).toEqual([])
  })
})

describe('SimulateProviderResultCommand', () => {
  it('approved sobre la preferencia → pedido pagado y el pago queda para getPayment', async () => {
    const { h, order, access } = setup()
    await h.preference.execute(access, KEY_1)
    await expect(
      h.simulate.execute({
        preferenceId: 'sim-pref-1',
        providerPaymentId: null,
        result: 'approved',
      }),
    ).resolves.toEqual({ number: order.number })
    const [attempt] = h.payments.of(order.id)
    expect(attempt).toMatchObject({ status: 'approved', statusDetail: 'accredited' })
    expect(attempt?.providerPaymentId).toMatch(/^[1-9]\d{9}$/)
    expect(h.gateway.payments.get(attempt?.providerPaymentId ?? '')).toMatchObject({
      status: 'approved',
      externalReference: order.number,
    })
    expect(h.orders.get(order.id).status).toBe('paid')
  })

  it('pending deja la preferencia pendiente y activa', async () => {
    const { h, order, access } = setup()
    await h.preference.execute(access, KEY_1)
    await h.simulate.execute({
      preferenceId: 'sim-pref-1',
      providerPaymentId: null,
      result: 'pending',
    })
    expect(h.payments.of(order.id)[0]).toMatchObject({
      status: 'pending',
      statusDetail: 'pending_waiting_payment',
      isActive: true,
    })
  })

  it('el desafío 3DS: challenge_ok aprueba y challenge_failed rechaza', async () => {
    const ok = setup()
    const { attempt } = await ok.payByCard('3DS')
    await ok.h.simulate.execute({
      preferenceId: null,
      providerPaymentId: attempt.providerPaymentId,
      result: 'challenge_ok',
    })
    expect(ok.h.orders.get(ok.order.id).status).toBe('paid')

    const failed = setup()
    const { attempt: other } = await failed.payByCard('3DS')
    await failed.h.simulate.execute({
      preferenceId: null,
      providerPaymentId: other.providerPaymentId,
      result: 'challenge_failed',
    })
    expect(failed.h.payments.of(failed.order.id)[0]).toMatchObject({
      status: 'rejected',
      statusDetail: 'cc_rejected_3ds_challenge',
      isActive: false,
      challengeUrl: null,
    })
  })

  it('un intento que ya no está activo → 409 intent_not_active', async () => {
    const { h, access } = setup()
    await h.preference.execute(access, KEY_1)
    await h.preference.execute(access, KEY_2)
    await expect(
      h.simulate.execute({
        preferenceId: 'sim-pref-1',
        providerPaymentId: null,
        result: 'approved',
      }),
    ).rejects.toBeInstanceOf(IntentNotActiveError)
    await h.simulate.execute({
      preferenceId: 'sim-pref-2',
      providerPaymentId: null,
      result: 'approved',
    })
    await expect(
      h.simulate.execute({
        preferenceId: 'sim-pref-2',
        providerPaymentId: null,
        result: 'approved',
      }),
    ).rejects.toBeInstanceOf(IntentNotActiveError)
  })

  it('una preferencia o un pago que no existen → 404', async () => {
    const { h } = setup()
    await expect(
      h.simulate.execute({
        preferenceId: 'sim-pref-9',
        providerPaymentId: null,
        result: 'approved',
      }),
    ).rejects.toBeInstanceOf(PaymentAttemptNotFoundError)
    await expect(
      h.simulate.execute({ preferenceId: null, providerPaymentId: null, result: 'approved' }),
    ).rejects.toThrow('El simulador necesita una preferencia o un pago')
  })
})
