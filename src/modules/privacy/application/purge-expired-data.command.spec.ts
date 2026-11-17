import { describe, expect, it } from 'vitest'

import type { PurgeTarget } from '../domain/retention'
import { PURGE_BATCH_SIZE, PurgeExpiredDataCommand } from './purge-expired-data.command'
import type { ExpiredDataRepository } from './ports/expired-data.repository.port'

const NOW = new Date('2026-11-17T12:00:00.000Z')
const HOUR = 60 * 60 * 1_000
const DAY = 24 * HOUR

/** Fila en memoria: a qué tipo pertenece, su fecha de referencia y si la purga la puede tocar. */
interface Row {
  name: string
  target: PurgeTarget | 'orders'
  at: Date
  /** `false` para filas que la purga nunca toca (reseñas aprobadas, arrepentimientos). */
  purgeable: boolean
}

/** Repositorio en memoria que borra de a lotes, como el de Prisma. */
class InMemoryExpiredData implements ExpiredDataRepository {
  readonly calls: { target: PurgeTarget; cutoff: Date; limit: number }[] = []

  constructor(public rows: Row[]) {}

  deleteBatch(target: PurgeTarget, cutoff: Date, limit: number): Promise<number> {
    this.calls.push({ target, cutoff, limit })
    const doomed = this.rows
      .filter((row) => row.target === target && row.purgeable && row.at < cutoff)
      .slice(0, limit)
    this.rows = this.rows.filter((row) => !doomed.includes(row))
    return Promise.resolve(doomed.length)
  }
}

function ago(ms: number): Date {
  return new Date(NOW.getTime() - ms)
}

function monthsAgo(months: number): Date {
  const date = new Date(NOW)
  date.setUTCMonth(date.getUTCMonth() - months)
  return date
}

describe('PurgeExpiredDataCommand', () => {
  it('Review Focus 4: borra lo vencido y deja lo que se conserva', async () => {
    const repository = new InMemoryExpiredData([
      { name: 'pedido de 9 años', target: 'orders', at: monthsAgo(108), purgeable: false },
      { name: 'reseña aprobada vieja', target: 'reviews', at: monthsAgo(60), purgeable: false },
      {
        name: 'arrepentimiento viejo',
        target: 'contactMessages',
        at: monthsAgo(60),
        purgeable: false,
      },
      { name: 'clave de 47 h', target: 'idempotencyKeys', at: ago(47 * HOUR), purgeable: true },
      { name: 'clave de 49 h', target: 'idempotencyKeys', at: ago(49 * HOUR), purgeable: true },
      {
        name: 'mensaje de 25 meses',
        target: 'contactMessages',
        at: monthsAgo(25),
        purgeable: true,
      },
      {
        name: 'mensaje de 23 meses',
        target: 'contactMessages',
        at: monthsAgo(23),
        purgeable: true,
      },
      {
        name: 'reseña rechazada de 13 meses',
        target: 'reviews',
        at: monthsAgo(13),
        purgeable: true,
      },
      {
        name: 'reseña pendiente de 11 meses',
        target: 'reviews',
        at: monthsAgo(11),
        purgeable: true,
      },
      {
        name: 'token vencido hace 8 días',
        target: 'passwordResetTokens',
        at: ago(8 * DAY),
        purgeable: true,
      },
      {
        name: 'token vencido hace 6 días',
        target: 'passwordResetTokens',
        at: ago(6 * DAY),
        purgeable: true,
      },
      { name: 'webhook de 91 días', target: 'webhookEvents', at: ago(91 * DAY), purgeable: true },
      { name: 'outbox de 91 días', target: 'outboxEvents', at: ago(91 * DAY), purgeable: true },
      { name: 'outbox de 89 días', target: 'outboxEvents', at: ago(89 * DAY), purgeable: true },
    ])

    const summary = await new PurgeExpiredDataCommand(repository).execute(NOW)

    expect(summary).toEqual({
      idempotencyKeys: 1,
      passwordResetTokens: 1,
      contactMessages: 1,
      webhookEvents: 1,
      outboxEvents: 1,
      reviews: 1,
    })
    expect(repository.rows.map((row) => row.name)).toEqual([
      'pedido de 9 años',
      'reseña aprobada vieja',
      'arrepentimiento viejo',
      'clave de 47 h',
      'mensaje de 23 meses',
      'reseña pendiente de 11 meses',
      'token vencido hace 6 días',
      'outbox de 89 días',
    ])
  })

  it('borra de a lotes hasta que un lote sale incompleto', async () => {
    const old = ago(72 * HOUR)
    const rows: Row[] = Array.from({ length: PURGE_BATCH_SIZE + 3 }, (_, index) => ({
      name: `clave ${String(index)}`,
      target: 'idempotencyKeys',
      at: old,
      purgeable: true,
    }))
    const repository = new InMemoryExpiredData(rows)

    const summary = await new PurgeExpiredDataCommand(repository).execute(NOW)

    expect(summary.idempotencyKeys).toBe(PURGE_BATCH_SIZE + 3)
    expect(
      repository.calls
        .filter((call) => call.target === 'idempotencyKeys')
        .map((call) => call.limit),
    ).toEqual([PURGE_BATCH_SIZE, PURGE_BATCH_SIZE])
  })

  it('rechaza una fecha inválida sin borrar nada', async () => {
    const repository = new InMemoryExpiredData([])

    await expect(
      new PurgeExpiredDataCommand(repository).execute(new Date(Number.NaN)),
    ).rejects.toThrow('La fecha de la purga no es válida')
    expect(repository.calls).toEqual([])
  })
})
