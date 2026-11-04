import { describe, expect, it } from 'vitest'

import type { Clock } from '../../../../shared/domain/clock'
import type { DashboardReader, DashboardSnapshot } from '../ports/dashboard-reader.port'
import { GetDashboardSummaryQuery } from './get-dashboard-summary.query'

const NOW = new Date('2026-11-04T15:00:00.000Z')
const clock: Clock = { now: () => NOW }

/** Cifras de prueba: dos pedidos con algo de pago para mirar. */
function snapshot(overrides: Partial<DashboardSnapshot> = {}): DashboardSnapshot {
  return {
    salesTodayArs: 79998,
    salesLast7DaysArs: 412500,
    ordersToShip: 3,
    lowStock: [{ id: 'prd-1', name: 'Mate Galleta', stock: 0 }],
    pendingReviews: 4,
    unreadMessages: 2,
    paymentIssues: [
      {
        orderNumber: 'GLP-09001',
        paymentStatus: 'approved',
        totalArs: 92998,
        createdAt: new Date('2026-11-01T12:00:00.000Z'),
        unsettledRefundsArs: [46499],
      },
      {
        orderNumber: 'GLP-09002',
        paymentStatus: 'charged_back',
        totalArs: 46499,
        createdAt: new Date('2026-11-02T12:00:00.000Z'),
        unsettledRefundsArs: [],
      },
    ],
    ...overrides,
  }
}

/** Lector en memoria que anota cuándo lo llamaron y con qué hora. */
class InMemoryDashboardReader implements DashboardReader {
  readonly calls: Date[] = []

  constructor(
    private readonly data: DashboardSnapshot,
    private readonly log: string[] = [],
  ) {}

  read(now: Date): Promise<DashboardSnapshot> {
    this.log.push('read')
    this.calls.push(now)
    return Promise.resolve(this.data)
  }
}

describe('GetDashboardSummaryQuery', () => {
  it('vence los pedidos atrasados antes de leer y lee con la hora del reloj', async () => {
    const log: string[] = []
    const reader = new InMemoryDashboardReader(snapshot(), log)
    const expire = {
      expireDue: () => {
        log.push('expire')
        return Promise.resolve({ expired: 1, failed: [] })
      },
    }

    await new GetDashboardSummaryQuery(reader, expire, clock).execute()

    expect(log).toEqual(['expire', 'read'])
    expect(reader.calls).toEqual([NOW])
  })

  it('devuelve las cifras en el orden del contrato con las alertas armadas', async () => {
    const reader = new InMemoryDashboardReader(snapshot())
    const expire = { expireDue: () => Promise.resolve({ expired: 0, failed: [] }) }

    const summary = await new GetDashboardSummaryQuery(reader, expire, clock).execute()

    expect(Object.keys(summary)).toEqual([
      'salesTodayArs',
      'salesLast7DaysArs',
      'ordersToShip',
      'lowStock',
      'pendingReviews',
      'unreadMessages',
      'paymentAlerts',
    ])
    expect(summary).toEqual({
      salesTodayArs: 79998,
      salesLast7DaysArs: 412500,
      ordersToShip: 3,
      lowStock: [{ id: 'prd-1', name: 'Mate Galleta', stock: 0 }],
      pendingReviews: 4,
      unreadMessages: 2,
      paymentAlerts: [
        {
          orderNumber: 'GLP-09002',
          kind: 'charged_back',
          message:
            'Contracargo por $46.499: el cliente desconoció el pago. Revisalo en Mercado Pago.',
        },
        {
          orderNumber: 'GLP-09001',
          kind: 'duplicate_payment',
          message: 'Se aprobó un segundo pago de $46.499. Devolvelo desde Mercado Pago.',
        },
      ],
    })
  })

  it('si un pedido no se pudo vencer, igual devuelve el resumen (el barrido lo reintenta)', async () => {
    const reader = new InMemoryDashboardReader(snapshot({ paymentIssues: [] }))
    const expire = {
      expireDue: () =>
        Promise.resolve({
          expired: 0,
          failed: [{ orderId: 'o-1', number: 'GLP-00001', error: new Error('falló') }],
        }),
    }

    const summary = await new GetDashboardSummaryQuery(reader, expire, clock).execute()

    expect(summary.ordersToShip).toBe(3)
    expect(summary.paymentAlerts).toEqual([])
  })

  it('rechaza cifras que no son enteros no negativos', async () => {
    const expire = { expireDue: () => Promise.resolve({ expired: 0, failed: [] }) }

    await expect(
      new GetDashboardSummaryQuery(
        new InMemoryDashboardReader(snapshot({ ordersToShip: -1 })),
        expire,
        clock,
      ).execute(),
    ).rejects.toThrow(
      new RangeError(
        'La cifra ordersToShip del resumen tiene que ser un entero no negativo (llegó -1).',
      ),
    )
    await expect(
      new GetDashboardSummaryQuery(
        new InMemoryDashboardReader(
          snapshot({ lowStock: [{ id: 'prd-1', name: 'Mate Galleta', stock: 1.5 }] }),
        ),
        expire,
        clock,
      ).execute(),
    ).rejects.toThrow(
      new RangeError(
        'La cifra lowStock.stock del resumen tiene que ser un entero no negativo (llegó 1.5).',
      ),
    )
  })
})
