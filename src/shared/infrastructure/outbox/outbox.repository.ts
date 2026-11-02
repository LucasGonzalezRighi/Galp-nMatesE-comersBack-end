import { Injectable } from '@nestjs/common'

import type { DomainEvent } from '../../domain/domain-event'
import { isId } from '../../domain/id'
import type { Prisma } from '../../../generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'

/** Cuántos eventos toma el relay por vuelta. */
export const OUTBOX_BATCH_SIZE = 50

/** Evento del outbox todavía sin publicar. */
export interface PendingOutboxEvent {
  /** Id del evento. */
  id: string
  /** Tipo del evento. */
  type: string
  /** Tipo del agregado. */
  aggregateType: string
  /** Id del agregado. */
  aggregateId: string
  /** Cuándo pasó. */
  occurredAt: Date
  /** Datos del evento (JSON). */
  payload: unknown
}

/**
 * Tabla `outbox_events`: los módulos guardan sus eventos de dominio con {@link append} dentro de
 * la misma transacción que el cambio, y el `OutboxRelay` los publica en BullMQ.
 */
@Injectable()
export class OutboxRepository {
  /** @param prisma - Cliente de Prisma de la app. */
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Guarda un evento en el outbox dentro de una transacción. Si el evento ya estaba (mismo id),
   * no hace nada: guardar dos veces el mismo evento no lo duplica.
   *
   * @param tx - Cliente de la transacción (`prisma.$transaction(async (tx) => …)`).
   * @param event - El evento de dominio.
   * @throws {TypeError} En español, si el id del evento no es un UUID v7.
   */
  async append(tx: Prisma.TransactionClient, event: DomainEvent): Promise<void> {
    if (!isId(event.id)) {
      throw new TypeError(
        `El id de un evento tiene que ser un UUID v7 (llegó "${String(event.id)}")`,
      )
    }
    await tx.outboxEvent.createMany({
      data: [
        {
          id: event.id,
          type: event.type,
          aggregateType: event.aggregateType,
          aggregateId: event.aggregateId,
          occurredAt: event.occurredAt,
          payload: event.payload,
        },
      ],
      skipDuplicates: true,
    })
  }

  /**
   * Los eventos sin publicar más viejos (usa el índice parcial `outbox_events_unpublished_idx`).
   *
   * @param limit - Máximo de eventos, entero de 1 a 1000.
   * @returns Los eventos, del más viejo al más nuevo.
   * @throws {RangeError} En español, si `limit` está fuera de rango.
   */
  async findUnpublished(limit: number = OUTBOX_BATCH_SIZE): Promise<PendingOutboxEvent[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) {
      throw new RangeError(
        `El límite de eventos tiene que ser un entero de 1 a 1000 (llegó ${String(limit)})`,
      )
    }
    return this.prisma.outboxEvent.findMany({
      where: { publishedAt: null },
      orderBy: { occurredAt: 'asc' },
      take: limit,
      select: {
        id: true,
        type: true,
        aggregateType: true,
        aggregateId: true,
        occurredAt: true,
        payload: true,
      },
    })
  }

  /**
   * Marca un evento como publicado.
   *
   * @param id - Id del evento.
   * @param publishedAt - Cuándo se publicó.
   */
  async markPublished(id: string, publishedAt: Date): Promise<void> {
    await this.prisma.outboxEvent.updateMany({ where: { id }, data: { publishedAt } })
  }

  /**
   * Suma un intento fallido de publicación (queda pendiente para la próxima vuelta).
   *
   * @param id - Id del evento.
   */
  async recordFailure(id: string): Promise<void> {
    await this.prisma.outboxEvent.updateMany({
      where: { id },
      data: { attempts: { increment: 1 } },
    })
  }
}
