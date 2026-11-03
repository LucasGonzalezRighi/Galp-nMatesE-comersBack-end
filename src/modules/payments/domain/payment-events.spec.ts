import { describe, expect, it } from 'vitest'

import {
  orderPaidEvent,
  paymentApprovedEvent,
  paymentRefundedEvent,
  paymentRejectedEvent,
} from './payment-events'

const ORDER = { id: 'order-1', number: 'GLP-00001' }

describe('eventos de pagos (Ruling B-54)', () => {
  it('payment.approved, payment.rejected, payment.refunded y order.paid', () => {
    expect(
      paymentApprovedEvent(ORDER, { paymentId: 'pay-1', providerPaymentId: '123', amountArs: 100 }),
    ).toEqual({
      type: 'payment.approved',
      aggregateType: 'payment',
      aggregateId: 'pay-1',
      payload: {
        orderId: 'order-1',
        number: 'GLP-00001',
        paymentId: 'pay-1',
        providerPaymentId: '123',
        amountArs: 100,
      },
    })
    expect(paymentRejectedEvent(ORDER, { paymentId: 'pay-1', statusDetail: null })).toEqual({
      type: 'payment.rejected',
      aggregateType: 'payment',
      aggregateId: 'pay-1',
      payload: { orderId: 'order-1', number: 'GLP-00001', paymentId: 'pay-1', statusDetail: null },
    })
    expect(
      paymentRefundedEvent(ORDER, { paymentId: 'pay-1', amountArs: 100, reason: 'manual' }),
    ).toEqual({
      type: 'payment.refunded',
      aggregateType: 'payment',
      aggregateId: 'pay-1',
      payload: {
        orderId: 'order-1',
        number: 'GLP-00001',
        paymentId: 'pay-1',
        amountArs: 100,
        reason: 'manual',
      },
    })
    expect(orderPaidEvent(ORDER, new Date('2026-11-03T12:00:00.000Z'))).toEqual({
      type: 'order.paid',
      aggregateType: 'order',
      aggregateId: 'GLP-00001',
      payload: { orderId: 'order-1', number: 'GLP-00001', paidAt: '2026-11-03T12:00:00.000Z' },
    })
  })
})
