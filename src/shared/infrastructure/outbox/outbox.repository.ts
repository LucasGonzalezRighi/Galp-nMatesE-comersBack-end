import { Injectable } from '@nestjs/common'

import type { DomainEvent } from '../../domain/domain-event'
import { isId } from '../../domain/id'
import type { Prisma } from '../../../generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'

/** Cuántos eventos toma el relay por vuelta. */
export const OUTBOX_BATCH_SIZE = 50

/**
 * Cuántas veces un evento cuyo despacho agotó los reintentos de BullMQ vuelve a quedar pendiente
 * para el relay (auditoría NV-29). Las esperas entre vueltas son 1, 2, 4, 8, 16, 32 y 60 minutos
 * (unas 3 horas en total); después se da por perdido con un error en el log.
 */
export const OUTBOX_MAX_DISPATCH_ROUNDS = 8

/** Espera máxima entre una vuelta de despacho y la siguiente, en minutos. */
export const OUTBOX_REDISPATCH_MAX_MINUTES = 60

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
  /** Despachos que agotaron sus reintentos (0 la primera vez que se publica). */
  dispatchFailures: number
}

/** Qué pasó al reabrir un evento cuyo despacho agotó los reintentos. */
export type DispatchFailureOutcome =
  | {
      /** Vuelve a quedar pendiente: el relay lo publica desde `availableAt`. */
      status: 'reopened'
      /** Despachos fallidos contando este. */
      dispatchFailures: number
      /** Desde cuándo lo toma el relay. */
      availableAt: Date
    }
  | {
      /** Ya usó sus {@link OUTBOX_MAX_DISPATCH_ROUNDS} vueltas: queda publicado (perdido). */
      status: 'exhausted'
      /** Despachos fallidos. */
      dispatchFailures: number
    }
  | {
      /** El evento no existe en el outbox. */
      status: 'missing'
    }

/** Lo que el despachador lee y escribe del outbox (los tests lo cumplen en memoria). */
export interface OutboxEventReader {
  /**
   * @param id - Id del evento.
   * @returns El evento como está guardado, o `null` si no existe (o el id no es un UUID).
   */
  findById(id: string): Promise<PendingOutboxEvent | null>

  /**
   * Vuelve a dejar pendiente un evento cuyo despacho agotó los reintentos, con un contador y una
   * espera creciente, hasta {@link OUTBOX_MAX_DISPATCH_ROUNDS} veces.
   *
   * @param id - Id del evento.
   * @param now - Hora del fallo.
   * @returns Si quedó pendiente (y desde cuándo), si ya estaba agotado o si no existe.
   */
  reopenAfterDispatchFailure(id: string, now: Date): Promise<DispatchFailureOutcome>
}

/** Columnas que lee el relay y el despachador. */
const PENDING_SELECT = {
  id: true,
  type: true,
  aggregateType: true,
  aggregateId: true,
  occurredAt: true,
  payload: true,
  dispatchFailures: true,
} as const

/**
 * Tabla `outbox_events`: los módulos guardan sus eventos de dominio con {@link append} dentro de
 * la misma transacción que el cambio, y el `OutboxRelay` los publica en BullMQ. Si el despacho de
 * un evento agota los reintentos, {@link reopenAfterDispatchFailure} lo vuelve a dejar pendiente.
 */
@Injectable()
export class OutboxRepository implements OutboxEventReader {
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
   * Los eventos sin publicar más viejos que ya se pueden publicar (`available_at` vacío o
   * cumplido; usa el índice parcial `outbox_events_unpublished_idx`).
   *
   * @param now - Hora actual (un evento reabierto espera hasta su `available_at`).
   * @param limit - Máximo de eventos, entero de 1 a 1000.
   * @returns Los eventos, del más viejo al más nuevo.
   * @throws {RangeError} En español, si `limit` está fuera de rango.
   */
  async findUnpublished(
    now: Date,
    limit: number = OUTBOX_BATCH_SIZE,
  ): Promise<PendingOutboxEvent[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) {
      throw new RangeError(
        `El límite de eventos tiene que ser un entero de 1 a 1000 (llegó ${String(limit)})`,
      )
    }
    return this.prisma.outboxEvent.findMany({
      where: { publishedAt: null, OR: [{ availableAt: null }, { availableAt: { lte: now } }] },
      orderBy: { occurredAt: 'asc' },
      take: limit,
      select: PENDING_SELECT,
    })
  }

  /** {@inheritDoc OutboxEventReader.findById} */
  async findById(id: string): Promise<PendingOutboxEvent | null> {
    if (!isId(id)) return null
    return this.prisma.outboxEvent.findUnique({ where: { id }, select: PENDING_SELECT })
  }

  /**
   * {@inheritDoc OutboxEventReader.reopenAfterDispatchFailure}
   *
   * Un solo `UPDATE` condicional: la espera (`2^fallos` minutos, hasta
   * {@link OUTBOX_REDISPATCH_MAX_MINUTES}) sale del contador anterior.
   */
  async reopenAfterDispatchFailure(id: string, now: Date): Promise<DispatchFailureOutcome> {
    if (!isId(id)) return { status: 'missing' }
    const [reopened] = await this.prisma.$queryRaw<
      { dispatch_failures: number; available_at: Date }[]
    >`
      UPDATE outbox_events
      SET published_at = NULL,
          dispatch_failures = dispatch_failures + 1,
          available_at = ${now}::timestamptz
            + make_interval(mins => LEAST(${OUTBOX_REDISPATCH_MAX_MINUTES}::int, power(2, dispatch_failures)::int))
      WHERE id = ${id}::uuid AND dispatch_failures < ${OUTBOX_MAX_DISPATCH_ROUNDS}::int
      RETURNING dispatch_failures, available_at`
    if (reopened !== undefined) {
      return {
        status: 'reopened',
        dispatchFailures: reopened.dispatch_failures,
        availableAt: reopened.available_at,
      }
    }
    const row = await this.prisma.outboxEvent.findUnique({
      where: { id },
      select: { dispatchFailures: true },
    })
    return row === null
      ? { status: 'missing' }
      : { status: 'exhausted', dispatchFailures: row.dispatchFailures }
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
