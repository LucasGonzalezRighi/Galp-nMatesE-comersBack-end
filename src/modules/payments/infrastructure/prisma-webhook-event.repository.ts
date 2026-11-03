import { Injectable } from '@nestjs/common'

import { isUniqueViolation } from '../../../shared/infrastructure/prisma/prisma-errors'
import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service'
import { UUID_PATTERN } from '../../orders/infrastructure/order.mapper'
import { assertBatchLimit, assertDate } from '../../orders/infrastructure/prisma-order.repository'
import type {
  NewWebhookEvent,
  StoredWebhookEvent,
  WebhookEventRepository,
} from '../application/ports/webhook-event.repository.port'
import { toStoredWebhookEvent } from './payment.mapper'

/** Largo máximo de `last_error` que se guarda (el resto se corta). */
const LAST_ERROR_MAX_LENGTH = 1_000

/**
 * {@link WebhookEventRepository} con Prisma (tabla `webhook_events`). La deduplicación es el único
 * `(provider, event_id)`: un `INSERT` repetido choca (`P2002`) y se responde con la fila que ya
 * estaba (Ruling B-37). `attempts` cuenta los procesados (el que cerró la notificación y los que
 * fallaron en la cola, con su `last_error`).
 */
@Injectable()
export class PrismaWebhookEventRepository implements WebhookEventRepository {
  /** @param prisma - Cliente de Prisma de la app. */
  constructor(private readonly prisma: PrismaService) {}

  /** {@inheritDoc WebhookEventRepository.record} */
  async record(input: NewWebhookEvent): Promise<{ id: string; duplicate: boolean }> {
    try {
      const row = await this.prisma.webhookEvent.create({
        data: {
          provider: input.provider,
          eventId: input.eventId,
          type: input.type,
          action: input.action,
          resourceId: input.resourceId,
          signatureValid: input.signatureValid,
          payload: input.payload,
          receivedAt: input.receivedAt,
        },
        select: { id: true },
      })
      return { id: row.id, duplicate: false }
    } catch (error: unknown) {
      if (!isUniqueViolation(error)) throw error
      const existing = await this.prisma.webhookEvent.findUniqueOrThrow({
        where: { provider_eventId: { provider: input.provider, eventId: input.eventId } },
        select: { id: true },
      })
      return { id: existing.id, duplicate: true }
    }
  }

  /** {@inheritDoc WebhookEventRepository.findById} */
  async findById(id: string): Promise<StoredWebhookEvent | null> {
    if (!UUID_PATTERN.test(id)) return null
    const row = await this.prisma.webhookEvent.findUnique({ where: { id } })
    return row === null ? null : toStoredWebhookEvent(row)
  }

  /**
   * {@inheritDoc WebhookEventRepository.listUnprocessed}
   *
   * @throws {TypeError} En español, si alguna fecha no es válida.
   * @throws {RangeError} En español, si el límite no es un entero de 1 a 1000.
   */
  async listUnprocessed(
    receivedBefore: Date,
    receivedAfter: Date,
    limit: number,
  ): Promise<StoredWebhookEvent[]> {
    assertDate(receivedBefore, 'El límite superior de las notificaciones')
    assertDate(receivedAfter, 'El límite inferior de las notificaciones')
    assertBatchLimit(limit, 'El máximo de notificaciones sin procesar')
    const rows = await this.prisma.webhookEvent.findMany({
      where: { processedAt: null, receivedAt: { gte: receivedAfter, lte: receivedBefore } },
      orderBy: [{ receivedAt: 'asc' }, { id: 'asc' }],
      take: limit,
    })
    return rows.map(toStoredWebhookEvent)
  }

  /**
   * {@inheritDoc WebhookEventRepository.markProcessed}
   *
   * Suma el intento que la cerró. Un id que no existe no cambia nada.
   */
  async markProcessed(id: string, at: Date, lastError: string | null): Promise<void> {
    if (!UUID_PATTERN.test(id)) return
    await this.prisma.webhookEvent.updateMany({
      where: { id },
      data: { processedAt: at, lastError: truncate(lastError), attempts: { increment: 1 } },
    })
  }

  /**
   * Anota un procesado fallido (lo usa el worker de la cola antes de que BullMQ reintente): suma
   * el intento y guarda el error. La notificación sigue sin procesar.
   *
   * @param id - Id de la fila.
   * @param lastError - Motivo del fallo.
   */
  async recordFailure(id: string, lastError: string): Promise<void> {
    if (!UUID_PATTERN.test(id)) return
    await this.prisma.webhookEvent.updateMany({
      where: { id },
      data: { lastError: truncate(lastError), attempts: { increment: 1 } },
    })
  }
}

function truncate(message: string | null): string | null {
  return message === null ? null : message.slice(0, LAST_ERROR_MAX_LENGTH)
}
