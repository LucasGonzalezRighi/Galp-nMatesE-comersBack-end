import { Injectable } from '@nestjs/common'

import type {
  ContactMessage as ContactMessageRow,
  ContactReason as DbContactReason,
  Prisma,
} from '../../../generated/prisma/client'
import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service'
import type { ContactMessage, ContactReason, NewContactMessage } from '../domain/contact-message'
import type {
  ContactMessageFilter,
  ContactMessageRepository,
  ContactMessageSlice,
} from '../application/ports/contact-message.repository.port'

/** Un UUID de cualquier versión (los que no lo son no existen: 404 sin consultar). */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Del más nuevo al más viejo; el id (v7, creciente) desempata. */
const NEWEST_FIRST = [{ createdAt: 'desc' }, { id: 'desc' }] as const

/** Texto de cada motivo del contrato → su valor del enum `contact_reason` de Prisma. */
const REASON_TO_DB = {
  Pedido: 'pedido',
  Envío: 'envio',
  Cambio: 'cambio',
  Arrepentimiento: 'arrepentimiento',
  Otro: 'otro',
} as const satisfies Record<ContactReason, DbContactReason>

/** El camino inverso de {@link REASON_TO_DB}. */
const REASON_FROM_DB = Object.fromEntries(
  Object.entries(REASON_TO_DB).map(([text, value]) => [value, text]),
) as Record<DbContactReason, ContactReason>

/** Pasa una fila de `contact_messages` al mensaje del dominio. */
function toContactMessage(row: ContactMessageRow): ContactMessage {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    email: row.email,
    orderNumber: row.orderNumber,
    reason: row.reason === null ? null : REASON_FROM_DB[row.reason],
    message: row.message,
    code: row.code,
    createdAt: row.createdAt,
    readAt: row.readAt,
  }
}

/** Arma el `where` de la bandeja con los filtros que vinieron. */
function whereOf(filter: ContactMessageFilter): Prisma.ContactMessageWhereInput {
  return {
    ...(filter.kind === undefined ? {} : { kind: filter.kind }),
    ...(filter.read === undefined ? {} : { readAt: filter.read ? { not: null } : null }),
  }
}

/** Bandeja del dashboard con Prisma (Postgres). */
@Injectable()
export class PrismaContactMessageRepository implements ContactMessageRepository {
  /** @param prisma - Cliente de Prisma de la app. */
  constructor(private readonly prisma: PrismaService) {}

  /**
   * {@inheritDoc ContactMessageRepository.nextWithdrawalNumber}
   *
   * @throws {Error} Si la secuencia no devuelve un valor (o ya pasó de `WITHDRAWAL_CODE_MAX`:
   *   Postgres falla).
   */
  async nextWithdrawalNumber(): Promise<number> {
    const rows = await this.prisma.$queryRaw<
      { n: bigint }[]
    >`SELECT nextval('withdrawal_code_seq') AS n`
    const value = rows[0]?.n
    if (value === undefined)
      throw new Error('La secuencia de arrepentimientos no devolvió un valor')
    return Number(value)
  }

  /**
   * {@inheritDoc ContactMessageRepository.peekWithdrawalNumber}
   *
   * Lee el estado de la secuencia sin `nextval`: si ya se tomó algún número, el que sigue a
   * `last_value`; si no, `last_value` (el `START`).
   *
   * @throws {Error} Si la secuencia no devuelve un valor.
   */
  async peekWithdrawalNumber(): Promise<number> {
    const rows = await this.prisma.$queryRaw<{ n: bigint }[]>`
      SELECT (CASE WHEN is_called THEN last_value + 1 ELSE last_value END) AS n
      FROM withdrawal_code_seq`
    const value = rows[0]?.n
    if (value === undefined)
      throw new Error('La secuencia de arrepentimientos no devolvió un valor')
    return Number(value)
  }

  /** {@inheritDoc ContactMessageRepository.create} */
  async create(message: NewContactMessage): Promise<void> {
    await this.prisma.contactMessage.create({
      data: {
        kind: message.kind,
        name: message.name,
        email: message.email,
        orderNumber: message.orderNumber,
        reason: message.reason === null ? null : REASON_TO_DB[message.reason],
        message: message.message,
        code: message.code,
      },
      select: { id: true },
    })
  }

  /** {@inheritDoc ContactMessageRepository.list} */
  async list(
    filter: ContactMessageFilter,
    page: number,
    pageSize: number,
  ): Promise<ContactMessageSlice> {
    const where = whereOf(filter)
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.contactMessage.findMany({
        where,
        orderBy: [...NEWEST_FIRST],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.contactMessage.count({ where }),
    ])
    return { items: rows.map(toContactMessage), total }
  }

  /**
   * {@inheritDoc ContactMessageRepository.setRead}
   *
   * Leído se marca con un `UPDATE` condicional (`read_at IS NULL`), así la fecha del primero no
   * cambia aunque dos pedidos lleguen juntos.
   */
  async setRead(id: string, read: boolean, now: Date): Promise<ContactMessage | null> {
    if (!UUID_PATTERN.test(id)) return null
    const row = await this.prisma.$transaction(async (tx) => {
      await tx.contactMessage.updateMany({
        where: read ? { id, readAt: null } : { id, readAt: { not: null } },
        data: { readAt: read ? now : null },
      })
      return tx.contactMessage.findUnique({ where: { id } })
    })
    return row === null ? null : toContactMessage(row)
  }
}
