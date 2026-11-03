import { describe, expect, it } from 'vitest'

import { PAYMENT_STATUSES } from '../../orders/domain/order-status'
import { ACTIVE_PAYMENT_STATUSES, isActiveStatus } from './payment-attempt'

describe('isActiveStatus', () => {
  it('solo none, pending y action_required son activos', () => {
    expect(ACTIVE_PAYMENT_STATUSES).toEqual(['none', 'pending', 'action_required'])
    expect(PAYMENT_STATUSES.filter((status) => isActiveStatus(status))).toEqual([
      'none',
      'pending',
      'action_required',
    ])
  })

  it('rechaza un estado que no es del contrato', () => {
    expect(() => isActiveStatus('paid' as never)).toThrow(
      'El estado del pago "paid" no es del contrato',
    )
  })
})
