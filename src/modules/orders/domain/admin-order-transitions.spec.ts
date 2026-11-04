import { describe, expect, it } from 'vitest'

import {
  ADMIN_ORDER_TARGETS,
  type AdminOrderTarget,
  adminOrderTargets,
  checkOrderTransition,
  isAdminOrderTarget,
  STATUS_TEXT,
} from './admin-order-transitions'
import {
  ORDER_STATUSES,
  type OrderStatus,
  PAYMENT_STATUSES,
  type PaymentStatus,
} from './order-status'

// Casos de `frontend/packages/domain/src/admin-orders.test.ts`: la misma regla que el dashboard.

/** Estados del pedido que no esperan el pago: sus destinos no dependen del pago. */
type SettledStatus = Exclude<OrderStatus, 'pending_payment'>

const TARGETS_BY_STATUS: Record<SettledStatus, AdminOrderTarget[]> = {
  paid: ['preparing', 'shipped'],
  preparing: ['shipped'],
  shipped: ['delivered'],
  delivered: [],
  cancelled: [],
  expired: [],
  refunded: [],
}

const CANCELLABLE: PaymentStatus[] = ['none', 'rejected', 'cancelled']
const IN_PROGRESS: PaymentStatus[] = ['pending', 'action_required']
const OTHER_PAYMENTS = PAYMENT_STATUSES.filter(
  (payment) => !CANCELLABLE.includes(payment) && !IN_PROGRESS.includes(payment),
)
const SETTLED_STATUSES = ORDER_STATUSES.filter(
  (status): status is SettledStatus => status !== 'pending_payment',
)

describe('constantes', () => {
  it('los destinos que ofrece el admin', () => {
    expect(ADMIN_ORDER_TARGETS).toEqual(['preparing', 'shipped', 'delivered', 'cancelled'])
  })

  it('el texto de cada estado (el del mock del front)', () => {
    expect(STATUS_TEXT).toEqual({
      pending_payment: 'esperando el pago',
      paid: 'pagado',
      preparing: 'en preparación',
      shipped: 'despachado',
      delivered: 'entregado',
      cancelled: 'cancelado',
      expired: 'vencido',
      refunded: 'devuelto',
    })
  })

  it('isAdminOrderTarget reconoce solo los cuatro destinos', () => {
    expect(ADMIN_ORDER_TARGETS.every(isAdminOrderTarget)).toBe(true)
    expect(isAdminOrderTarget('paid')).toBe(false)
    expect(isAdminOrderTarget(undefined)).toBe(false)
  })
})

describe('adminOrderTargets', () => {
  it.each(
    SETTLED_STATUSES.flatMap((status) =>
      PAYMENT_STATUSES.map((payment) => [status, payment, TARGETS_BY_STATUS[status]] as const),
    ),
  )('%s con pago %s ofrece %j', (status, payment, expected) => {
    expect(adminOrderTargets(status, payment)).toEqual(expected)
  })

  it.each(CANCELLABLE)('pending_payment con pago %s solo se puede cancelar', (payment) => {
    expect(adminOrderTargets('pending_payment', payment)).toEqual(['cancelled'])
  })

  it.each([...IN_PROGRESS, ...OTHER_PAYMENTS])(
    'pending_payment con pago %s no ofrece ningún destino',
    (payment) => {
      expect(adminOrderTargets('pending_payment', payment)).toEqual([])
    },
  )

  it('devuelve una lista nueva cada vez', () => {
    const first = adminOrderTargets('paid', 'approved')
    first.push('cancelled')
    expect(adminOrderTargets('paid', 'approved')).toEqual(['preparing', 'shipped'])
  })
})

describe('checkOrderTransition', () => {
  it.each(
    SETTLED_STATUSES.flatMap((status) =>
      ADMIN_ORDER_TARGETS.map(
        (target) =>
          [
            status,
            target,
            TARGETS_BY_STATUS[status].includes(target) ? 'ok' : 'invalid_status_transition',
          ] as const,
      ),
    ),
  )('%s → %s da %s', (status, target, expected) => {
    expect(checkOrderTransition(status, 'approved', target)).toBe(expected)
  })

  it('pending_payment con pago none se cancela', () => {
    expect(checkOrderTransition('pending_payment', 'none', 'cancelled')).toBe('ok')
  })

  it.each(CANCELLABLE)('pending_payment con pago %s se cancela', (payment) => {
    expect(checkOrderTransition('pending_payment', payment, 'cancelled')).toBe('ok')
  })

  it('pending_payment con pago pending no se cancela: hay un pago en curso', () => {
    expect(checkOrderTransition('pending_payment', 'pending', 'cancelled')).toBe(
      'payment_in_progress',
    )
    expect(checkOrderTransition('pending_payment', 'action_required', 'cancelled')).toBe(
      'payment_in_progress',
    )
  })

  it.each(OTHER_PAYMENTS)(
    'pending_payment con pago %s no se cancela: la transición no es válida',
    (payment) => {
      expect(checkOrderTransition('pending_payment', payment, 'cancelled')).toBe(
        'invalid_status_transition',
      )
    },
  )

  it.each(
    PAYMENT_STATUSES.flatMap((payment) =>
      (['preparing', 'shipped', 'delivered'] as const).map((target) => [payment, target] as const),
    ),
  )('pending_payment con pago %s no pasa a %s', (payment, target) => {
    expect(checkOrderTransition('pending_payment', payment, target)).toBe(
      'invalid_status_transition',
    )
  })

  it('despachar dos veces no es válido', () => {
    expect(checkOrderTransition('shipped', 'approved', 'shipped')).toBe('invalid_status_transition')
  })

  it('un pedido pagado no se cancela, ni con un pago en curso', () => {
    expect(checkOrderTransition('paid', 'approved', 'cancelled')).toBe('invalid_status_transition')
    expect(checkOrderTransition('paid', 'pending', 'cancelled')).toBe('invalid_status_transition')
  })
})

describe('validación', () => {
  it('rechaza un estado del pedido desconocido', () => {
    expect(() => adminOrderTargets('lost' as OrderStatus, 'none')).toThrow(
      new RangeError('Estado de pedido desconocido: "lost".'),
    )
    expect(() => checkOrderTransition('lost' as OrderStatus, 'none', 'cancelled')).toThrow(
      RangeError,
    )
  })

  it('rechaza un estado del pago desconocido', () => {
    expect(() => adminOrderTargets('paid', 'paid' as PaymentStatus)).toThrow(
      new RangeError('Estado de pago desconocido: "paid".'),
    )
  })

  it('rechaza un destino que el admin no ofrece', () => {
    expect(() => checkOrderTransition('paid', 'approved', 'paid' as AdminOrderTarget)).toThrow(
      new RangeError('Destino de pedido desconocido: "paid".'),
    )
  })
})
