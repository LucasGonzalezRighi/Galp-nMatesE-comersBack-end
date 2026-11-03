import { describe, expect, it, vi } from 'vitest'

import type { CachePort } from '../../../shared/application/ports/cache.port'
import type { OutboxRepository } from '../../../shared/infrastructure/outbox/outbox.repository'
import type { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service'
import type { PaymentStatus } from '../domain/order-status'
import { PrismaOrderPaymentsAdapter } from './prisma-order-payments.adapter'

/** Adaptador con una base que no se puede tocar: cada consulta es un `vi.fn()` que falla. */
function setup() {
  const fail = () => Promise.reject(new Error('No tenía que consultar la base'))
  const prisma = {
    $transaction: vi.fn(fail),
    order: { findUnique: vi.fn(fail), findMany: vi.fn(fail), updateMany: vi.fn(fail) },
  }
  const cache = { del: vi.fn(fail) }
  const adapter = new PrismaOrderPaymentsAdapter(
    prisma as unknown as PrismaService,
    {} as OutboxRepository,
    cache as unknown as CachePort,
  )
  const untouched = () => {
    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(prisma.order.findUnique).not.toHaveBeenCalled()
    expect(prisma.order.findMany).not.toHaveBeenCalled()
    expect(prisma.order.updateMany).not.toHaveBeenCalled()
    expect(cache.del).not.toHaveBeenCalled()
  }
  return { adapter, untouched }
}

const NOW = new Date('2026-11-03T12:00:00.000Z')
const events = () => []

describe('PrismaOrderPaymentsAdapter (validaciones, sin base)', () => {
  it('un id que no es UUID no existe: null sin consultar', async () => {
    const { adapter, untouched } = setup()

    expect(await adapter.findForPaymentById('ord-1')).toBeNull()
    expect(await adapter.markPaid('ord-1', NOW, events)).toBeNull()
    expect(await adapter.markRefunded('ord-1', NOW, events)).toBeNull()
    await adapter.setPaymentStatus('ord-1', 'pending')
    untouched()
  })

  it('rechaza fechas inválidas, límites fuera de rango y estados de pago desconocidos', async () => {
    const { adapter, untouched } = setup()
    const id = '01900000-0000-7000-8000-000000000000'
    const invalid = new Date('x')

    await expect(adapter.markPaid(id, invalid, events)).rejects.toThrow(
      'El momento del pago no es una fecha válida',
    )
    await expect(adapter.markRefunded(id, invalid, events)).rejects.toThrow(
      'El momento de la devolución no es una fecha válida',
    )
    await expect(adapter.listAwaitingPayment(invalid, 10)).rejects.toThrow(TypeError)
    for (const limit of [0, 1.5, 1_001]) {
      await expect(adapter.listAwaitingPayment(NOW, limit)).rejects.toThrow(
        'El máximo de pedidos a conciliar tiene que ser un entero de 1 a 1000',
      )
    }
    await expect(adapter.setPaymentStatus(id, 'paid' as PaymentStatus)).rejects.toThrow(
      'El estado del pago "paid" no existe',
    )
    untouched()
  })
})
