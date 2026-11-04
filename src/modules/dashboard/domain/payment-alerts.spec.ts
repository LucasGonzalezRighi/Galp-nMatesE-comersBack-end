import { describe, expect, it } from 'vitest'

import { buildPaymentAlerts, type PaymentIssue } from './payment-alerts'

/** Pedido con algo de pago para mirar; por defecto, sin alertas. */
function issue(overrides: Partial<PaymentIssue> = {}): PaymentIssue {
  return {
    orderNumber: 'GLP-09001',
    paymentStatus: 'approved',
    totalArs: 92998,
    createdAt: new Date('2026-11-04T12:00:00.000Z'),
    unsettledRefundsArs: [],
    ...overrides,
  }
}

describe('buildPaymentAlerts', () => {
  it('arma los tres textos del mock: el total del pedido en los dos primeros y lo que hay que devolver en el duplicado', () => {
    // El orden de la demo del mock: GLP-09002, GLP-09012 y GLP-09011.
    const alerts = buildPaymentAlerts([
      issue({
        orderNumber: 'GLP-09011',
        paymentStatus: 'charged_back',
        totalArs: 46499,
        createdAt: new Date('2026-11-01T12:00:00.000Z'),
      }),
      issue({
        orderNumber: 'GLP-09012',
        paymentStatus: 'in_dispute',
        totalArs: 46499,
        createdAt: new Date('2026-11-02T12:00:00.000Z'),
      }),
      issue({
        orderNumber: 'GLP-09002',
        totalArs: 92998,
        createdAt: new Date('2026-11-03T12:00:00.000Z'),
        unsettledRefundsArs: [46499],
      }),
    ])

    expect(alerts).toEqual([
      {
        orderNumber: 'GLP-09002',
        kind: 'duplicate_payment',
        message: 'Se aprobó un segundo pago de $46.499. Devolvelo desde Mercado Pago.',
      },
      {
        orderNumber: 'GLP-09012',
        kind: 'in_dispute',
        message: 'Mediación abierta por $46.499. Respondé desde Mercado Pago.',
      },
      {
        orderNumber: 'GLP-09011',
        kind: 'charged_back',
        message:
          'Contracargo por $46.499: el cliente desconoció el pago. Revisalo en Mercado Pago.',
      },
    ])
  })

  it('ordena los pedidos del más nuevo al más viejo y, a igual fecha, por número de mayor a menor', () => {
    const older = new Date('2026-11-01T12:00:00.000Z')
    const newer = new Date('2026-11-03T12:00:00.000Z')

    const alerts = buildPaymentAlerts([
      issue({ orderNumber: 'GLP-09020', paymentStatus: 'in_dispute', createdAt: older }),
      issue({ orderNumber: 'GLP-09001', paymentStatus: 'charged_back', createdAt: newer }),
      issue({ orderNumber: 'GLP-09021', paymentStatus: 'in_dispute', createdAt: older }),
    ])

    expect(alerts.map((alert) => alert.orderNumber)).toEqual([
      'GLP-09001',
      'GLP-09021',
      'GLP-09020',
    ])
  })

  it('en un mismo pedido, primero el contracargo y después un duplicado por devolución, en el orden recibido', () => {
    const alerts = buildPaymentAlerts([
      issue({
        paymentStatus: 'charged_back',
        totalArs: 92998,
        unsettledRefundsArs: [46499, 12000],
      }),
    ])

    expect(alerts.map(({ kind, message }) => [kind, message])).toEqual([
      [
        'charged_back',
        'Contracargo por $92.998: el cliente desconoció el pago. Revisalo en Mercado Pago.',
      ],
      ['duplicate_payment', 'Se aprobó un segundo pago de $46.499. Devolvelo desde Mercado Pago.'],
      ['duplicate_payment', 'Se aprobó un segundo pago de $12.000. Devolvelo desde Mercado Pago.'],
    ])
  })

  it('un pedido sin contracargo, sin mediación y sin devoluciones pendientes no da alertas', () => {
    expect(buildPaymentAlerts([issue({ paymentStatus: 'refunded' }), issue()])).toEqual([])
    expect(buildPaymentAlerts([])).toEqual([])
  })

  it('no cambia la lista que recibe', () => {
    const issues = [
      issue({ orderNumber: 'GLP-09001', paymentStatus: 'in_dispute' }),
      issue({ orderNumber: 'GLP-09002', paymentStatus: 'in_dispute' }),
    ]

    buildPaymentAlerts(issues)

    expect(issues.map((item) => item.orderNumber)).toEqual(['GLP-09001', 'GLP-09002'])
  })

  it('rechaza datos inválidos con errores en español', () => {
    expect(() => buildPaymentAlerts([issue({ orderNumber: '' })])).toThrow(
      new TypeError('El número de pedido de una alerta de pago no puede estar vacío.'),
    )
    expect(() => buildPaymentAlerts([issue({ createdAt: new Date(Number.NaN) })])).toThrow(
      new TypeError('La fecha del pedido GLP-09001 no es válida.'),
    )
    expect(() =>
      buildPaymentAlerts([issue({ paymentStatus: 'charged_back', totalArs: -1 })]),
    ).toThrow(RangeError)
    expect(() => buildPaymentAlerts([issue({ unsettledRefundsArs: [1.5] })])).toThrow(RangeError)
  })
})
