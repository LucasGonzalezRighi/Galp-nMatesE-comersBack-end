import { describe, expect, it } from 'vitest'

import { PAYMENT_STATUSES } from '../../orders/domain/order-status'
import {
  FINAL_PAYMENT_STATUSES,
  isFinalStatus,
  isKnownProviderStatus,
  normalizePaymentStatus,
} from './provider-payment'

const TOTAL = 68397

function normalize(status: string, statusDetail: string | null, refundedArs = 0) {
  return normalizePaymentStatus({ status, statusDetail, refundedArs, amountArs: TOTAL })
}

describe('normalizePaymentStatus (Ruling B-39)', () => {
  it.each([
    ['approved', 'accredited', 'approved'],
    ['pending', 'pending_waiting_payment', 'pending'],
    ['pending', 'pending_challenge', 'action_required'],
    ['in_process', 'pending_contingency', 'pending'],
    ['in_process', 'pending_review_manual', 'pending'],
    ['in_process', 'pending_challenge', 'action_required'],
    ['authorized', 'pending_capture', 'pending'],
    ['authorized', 'pending_challenge', 'action_required'],
    ['rejected', 'cc_rejected_other_reason', 'rejected'],
    ['rejected', 'cc_rejected_3ds_challenge', 'rejected'],
    ['cancelled', 'expired', 'cancelled'],
    ['cancelled', 'by_collector', 'cancelled'],
    ['refunded', 'refunded', 'refunded'],
    ['in_mediation', null, 'in_dispute'],
    ['charged_back', 'settled', 'charged_back'],
  ])('%s / %s → %s', (status, statusDetail, expected) => {
    expect(normalize(status, statusDetail)).toBe(expected)
  })

  it('approved con algo devuelto (transaction_amount_refunded) es partially_refunded', () => {
    expect(normalize('approved', 'partially_refunded', 1000)).toBe('partially_refunded')
  })

  it('approved con todo devuelto es refunded', () => {
    expect(normalize('approved', 'accredited', TOTAL)).toBe('refunded')
  })

  it('un estado desconocido de Mercado Pago queda pending', () => {
    expect(normalize('algo_nuevo', null)).toBe('pending')
    expect(isKnownProviderStatus('algo_nuevo')).toBe(false)
    expect(isKnownProviderStatus('in_mediation')).toBe(true)
  })

  it('valida los montos', () => {
    expect(() => normalize('approved', null, -1)).toThrow(
      'El monto devuelto tiene que ser un número no negativo (llegó -1)',
    )
    expect(() =>
      normalizePaymentStatus({
        status: 'approved',
        statusDetail: null,
        refundedArs: 0,
        amountArs: Number.NaN,
      }),
    ).toThrow('El monto del pago tiene que ser un número no negativo (llegó NaN)')
  })
})

describe('isFinalStatus', () => {
  it('approved, refunded, partially_refunded, in_dispute y charged_back no retroceden', () => {
    const finals = ['approved', 'refunded', 'partially_refunded', 'in_dispute', 'charged_back']
    expect(FINAL_PAYMENT_STATUSES).toEqual(finals)
    expect(PAYMENT_STATUSES.filter((status) => isFinalStatus(status)).sort()).toEqual(
      [...finals].sort(),
    )
  })
})
