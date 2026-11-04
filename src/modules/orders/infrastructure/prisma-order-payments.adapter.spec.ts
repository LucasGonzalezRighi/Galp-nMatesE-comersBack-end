import { describe, expect, it, vi } from 'vitest'

import type { CachePort } from '../../../shared/application/ports/cache.port'
import type { OutboxRepository } from '../../../shared/infrastructure/outbox/outbox.repository'
import type { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service'
import type { Prisma } from '../../../generated/prisma/client'
import type { PaymentStatus } from '../domain/order-status'
import { PrismaOrderPaymentsAdapter } from './prisma-order-payments.adapter'
import { catalogCacheKeys } from './prisma-order.repository'

/** Adaptador con una base que no se puede tocar: cada consulta es un `vi.fn()` que falla. */
function setup() {
  const fail = () => Promise.reject(new Error('No tenía que consultar la base'))
  const prisma = {
    $transaction: vi.fn(fail),
    order: { findUnique: vi.fn(fail), findMany: vi.fn(fail), updateMany: vi.fn(fail) },
  }
  const cache = { get: vi.fn(fail), del: vi.fn(fail) }
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
    expect(cache.get).not.toHaveBeenCalled()
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

describe('catalogCacheKeys', () => {
  it('lee slugs y grupos en la transacción y arma las claves con la versión que recibe', async () => {
    const $queryRaw = vi.fn(() =>
      Promise.resolve([
        { slug: 'mate-imperial-premium', group: 'mate' },
        { slug: 'mate-camionero', group: 'mate' },
        { slug: 'bombillon-100-alpaca', group: 'bombilla' },
        { slug: 'raro', group: 'otro' },
      ]),
    )
    const tx = { $queryRaw } as unknown as Prisma.TransactionClient

    const keys = await catalogCacheKeys(tx, ['p1', 'p2', 'p3', 'p4'])

    expect($queryRaw).toHaveBeenCalledTimes(1)
    expect(keys(3)).toEqual([
      'catalog:v3:products:slug:mate-imperial-premium',
      'catalog:v3:products:slug:mate-camionero',
      'catalog:v3:products:slug:bombillon-100-alpaca',
      'catalog:v3:products:slug:raro',
      'catalog:v3:products:group:mate',
      'catalog:v3:products:group:bombilla',
    ])
    expect(keys(4)[0]).toBe('catalog:v4:products:slug:mate-imperial-premium')
  })

  it('sin productos no consulta y no borra nada', async () => {
    const $queryRaw = vi.fn()
    const tx = { $queryRaw } as unknown as Prisma.TransactionClient

    expect((await catalogCacheKeys(tx, []))(0)).toEqual([])
    expect($queryRaw).not.toHaveBeenCalled()
  })
})
