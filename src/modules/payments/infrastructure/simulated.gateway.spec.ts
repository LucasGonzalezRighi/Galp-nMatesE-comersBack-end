import { describe, expect, it } from 'vitest'

import { FIXED_NOW, FixedClock } from '../../../../test/support/clock'
import { FixedPaymentsSettings, simToken } from '../../../../test/support/payments'
import { newId } from '../../../shared/domain/id'
import type { OrderForPayment } from '../../orders/application/ports/order-payments.port'
import type { CardChargeInput } from '../application/ports/payment-gateway.port'
import { InstallmentsNotAvailableError, InvalidCardTokenError } from '../domain/payments-errors'
import { SimulatedGateway } from './simulated.gateway'

const ORIGIN = 'http://localhost:3001'

const ORDER: OrderForPayment = {
  id: '019a0000-0000-7000-8000-000000000001',
  number: 'GLP-10001',
  status: 'pending_payment',
  paymentStatus: 'none',
  paymentMethod: 'card',
  totalArs: 68397,
  shippingCostArs: 0,
  accessTokenHash: 'hash',
  reservedUntil: new Date('2026-11-02T12:30:00.000Z'),
  createdAt: FIXED_NOW,
  customerId: null,
  contact: { email: 'ana@example.com', firstName: 'Ana', lastName: 'Gómez', phone: null },
  lines: [{ id: 'line-1', name: 'Mate', quantity: 1, totalArs: 68397 }],
}

/** Cobro de prueba; cada uno con su clave idempotente, salvo que se pase la misma. */
function charge(token: string, installments = 1, idempotencyKey = newId()): CardChargeInput {
  return {
    order: ORDER,
    idempotencyKey,
    token,
    paymentMethodId: 'visa',
    issuerId: '310',
    installments,
    payer: { email: 'ana@example.com', identification: { type: 'DNI', number: '12345678' } },
    notificationUrl: null,
    statementDescriptor: 'GALPON MATES',
  }
}

function setup() {
  const settings = new FixedPaymentsSettings()
  let seed = 0
  const gateway = new SimulatedGateway(settings, ORIGIN, new FixedClock(), () => {
    seed += 1
    return seed / 100
  })
  return { gateway, settings }
}

describe('SimulatedGateway (Ruling B-55)', () => {
  it.each([
    ['APRO', 'approved', 'accredited'],
    ['CONT', 'pending', 'pending_contingency'],
    ['OTHE', 'rejected', 'cc_rejected_other_reason'],
    ['FUND', 'rejected', 'cc_rejected_insufficient_amount'],
    ['SECU', 'rejected', 'cc_rejected_bad_filled_security_code'],
    ['EXPI', 'rejected', 'cc_rejected_bad_filled_date'],
    ['CALL', 'rejected', 'cc_rejected_call_for_authorize'],
    ['NADIE', 'rejected', 'cc_rejected_other_reason'],
  ])('el titular %s da %s/%s', async (holder, status, statusDetail) => {
    const { gateway } = setup()

    const payment = await gateway.createCardPayment(charge(simToken(holder)))

    expect(payment).toMatchObject({
      status,
      statusDetail,
      amountArs: 68397,
      refundedArs: 0,
      installments: 1,
      paymentTypeId: 'credit_card',
      paymentMethodId: 'visa',
      cardLastFour: '3704',
      issuerId: '310',
      externalReference: 'GLP-10001',
      challengeUrl: null,
      approvedAt: status === 'approved' ? FIXED_NOW : null,
    })
    expect(payment.providerPaymentId).toMatch(/^[1-9]\d{9}$/)
  })

  it('3DS queda pending_challenge con la URL del desafío del simulador', async () => {
    const { gateway } = setup()

    const payment = await gateway.createCardPayment(charge(simToken('3DS', 'xxxx')))

    expect(payment).toMatchObject({
      status: 'pending',
      statusDetail: 'pending_challenge',
      cardLastFour: null,
      challengeUrl: `${ORIGIN}/api/v1/__simulated/mercadopago/challenge?payment=${payment.providerPaymentId}`,
    })
  })

  it('un token que no es sim_ da InvalidCardTokenError', async () => {
    const { gateway } = setup()

    await expect(
      gateway.createCardPayment(charge('ff8080814c11e237014c1ff593b57b4d')),
    ).rejects.toThrow(InvalidCardTokenError)
  })

  it('las cuotas tienen que estar entre las del simulador (máximo sin interés de los ajustes)', async () => {
    const { gateway, settings } = setup()
    settings.installmentsMax = 3

    await expect(gateway.createCardPayment(charge(simToken('APRO'), 3))).resolves.toMatchObject({
      installments: 3,
    })
    await expect(gateway.createCardPayment(charge(simToken('APRO'), 6))).resolves.toMatchObject({
      installments: 6,
    })
    await expect(gateway.createCardPayment(charge(simToken('APRO'), 4))).rejects.toThrow(
      InstallmentsNotAvailableError,
    )
  })

  it('validateCardCharge da los mismos 422 que el cobro, sin guardar ningún pago', async () => {
    const { gateway, settings } = setup()
    settings.installmentsMax = 3

    await expect(gateway.validateCardCharge(charge(simToken('APRO'), 3))).resolves.toBeUndefined()
    await expect(gateway.validateCardCharge(charge(simToken('APRO'), 4))).rejects.toThrow(
      InstallmentsNotAvailableError,
    )
    await expect(
      gateway.validateCardCharge(charge('ff8080814c11e237014c1ff593b57b4d')),
    ).rejects.toThrow(InvalidCardTokenError)
    expect(gateway.callsTo('validateCardCharge')).toHaveLength(3)
    expect(gateway.callsTo('createCardPayment')).toEqual([])
    await expect(gateway.getPayment('1234567890')).resolves.toBeNull()
  })

  it('getPayment devuelve lo último aplicado; remember lo reemplaza', async () => {
    const { gateway } = setup()
    const payment = await gateway.createCardPayment(charge(simToken('3DS')))

    await expect(gateway.getPayment(payment.providerPaymentId)).resolves.toEqual(payment)
    gateway.remember({ ...payment, status: 'approved', statusDetail: 'accredited' })
    await expect(gateway.getPayment(payment.providerPaymentId)).resolves.toMatchObject({
      status: 'approved',
    })
    await expect(gateway.getPayment('1000000000')).resolves.toBeNull()
  })

  it('cancelPayment cancela un pendiente, no toca un aprobado y da null si no existe', async () => {
    const { gateway } = setup()
    const pending = await gateway.createCardPayment(charge(simToken('CONT')))
    const approved = await gateway.createCardPayment(charge(simToken('APRO')))

    await expect(gateway.cancelPayment(pending.providerPaymentId)).resolves.toMatchObject({
      status: 'cancelled',
      statusDetail: 'by_collector',
    })
    await expect(gateway.getPayment(pending.providerPaymentId)).resolves.toMatchObject({
      status: 'cancelled',
    })
    await expect(gateway.cancelPayment(approved.providerPaymentId)).resolves.toMatchObject({
      status: 'approved',
    })
    await expect(gateway.cancelPayment('1000000000')).resolves.toBeNull()
  })

  it('la misma clave devuelve el mismo pago como está ahora, sin cobrar otro (X-Idempotency-Key)', async () => {
    const { gateway } = setup()
    const first = await gateway.createCardPayment(charge(simToken('CONT'), 1, 'clave-1'))
    gateway.remember({ ...first, status: 'approved', statusDetail: 'accredited' })

    const again = await gateway.createCardPayment(charge(simToken('CONT'), 1, 'clave-1'))
    const other = await gateway.createCardPayment(charge(simToken('CONT'), 1, 'clave-2'))

    expect(again).toMatchObject({
      providerPaymentId: first.providerPaymentId,
      status: 'approved',
      statusDetail: 'accredited',
    })
    expect(other.providerPaymentId).not.toBe(first.providerPaymentId)
    expect(gateway.callsTo('createCardPayment')).toHaveLength(3)
  })

  it('la misma clave devuelve la misma preferencia; otra clave crea otra', async () => {
    const { gateway } = setup()
    const input = {
      order: ORDER,
      idempotencyKey: 'clave-1',
      notificationUrl: null,
      backUrl: 'http://localhost:4300/checkout/resultado?pedido=GLP-10001',
      expiresAt: ORDER.reservedUntil,
      statementDescriptor: 'GALPON MATES',
    }

    const first = await gateway.createPreference(input)
    const again = await gateway.createPreference(input)
    const other = await gateway.createPreference({ ...input, idempotencyKey: 'clave-2' })

    expect(again).toEqual(first)
    expect(other.preferenceId).not.toBe(first.preferenceId)
  })

  it('preferencia sim-pref- con el initPoint del checkout simulado', async () => {
    const { gateway } = setup()

    const result = await gateway.createPreference({
      order: ORDER,
      idempotencyKey: 'key',
      notificationUrl: null,
      backUrl: 'http://localhost:4300/checkout/resultado?pedido=GLP-10001',
      expiresAt: ORDER.reservedUntil,
      statementDescriptor: 'GALPON MATES',
    })

    expect(result.preferenceId).toMatch(/^sim-pref-[0-9a-f-]{36}$/)
    expect(result.initPoint).toBe(
      `${ORIGIN}/api/v1/__simulated/mercadopago/checkout?preference=${result.preferenceId}`,
    )
  })

  it('refundPayment, expirePreference y las demás llamadas quedan en calls', async () => {
    const { gateway } = setup()

    const refund = await gateway.refundPayment('1234567890', 'refund-key')
    await gateway.expirePreference('sim-pref-1')
    const options = await gateway.getInstallments({
      bin: '450995',
      paymentTypeId: 'debit_card',
      amountArs: 68397,
      maxWithoutInterest: 3,
    })

    expect(refund.providerRefundId).toMatch(/^\d{10}$/)
    expect(refund.status).toBe('approved')
    expect(options.map((option) => option.installments)).toEqual([1])
    expect(gateway.calls.map((call) => call.method)).toEqual([
      'refundPayment',
      'expirePreference',
      'getInstallments',
    ])
    expect(gateway.callsTo('refundPayment')).toEqual([['1234567890', 'refund-key']])
  })

  it('las cuotas de crédito son las del mock (sin interés hasta el máximo, 6 y 12 con CFT)', async () => {
    const { gateway } = setup()

    const options = await gateway.getInstallments({
      bin: '450995',
      paymentTypeId: 'credit_card',
      amountArs: 68397,
      maxWithoutInterest: 3,
    })

    expect(options.map((option) => [option.installments, option.cftPercent])).toEqual([
      [1, 0],
      [2, 0],
      [3, 0],
      [6, 45.9],
      [12, 45.9],
    ])
  })

  it('el origen del simulador tiene que ser una URL sin barra final', () => {
    expect(
      () =>
        new SimulatedGateway(
          new FixedPaymentsSettings(),
          'http://localhost:3001/',
          new FixedClock(),
        ),
    ).toThrow('El origen del simulador')
  })
})
