import { Injectable } from '@nestjs/common'

import { Prisma } from '../../../generated/prisma/client'
import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service'
import type {
  AuditLogRepository,
  NewAuditEntry,
} from '../application/ports/audit-log.repository.port'
import type { SnapshotKeyType, SnapshotSource } from '../domain/admin-write'
import type { JsonRow } from '../domain/audit-changes'

/** Forma de un nombre de tabla o de columna de la tabla de descriptores. */
const IDENTIFIER = /^[a-z_]+$/

/** Largo máximo de un id de texto (un número de pedido, una clave de contenido). */
const MAX_TEXT_KEY_LENGTH = 200

/**
 * Indica si un id tiene la forma de su columna. Si no la tiene, la fila no existe y no hace falta
 * consultar (y un `::uuid` con otra cosa haría fallar la consulta).
 */
const KEY_SHAPES: Readonly<Record<SnapshotKeyType, (id: string) => boolean>> = {
  uuid: (id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id),
  integer: (id) => /^\d{1,9}$/.test(id),
  // Postgres no guarda el carácter nulo en un texto.
  text: (id) => id.length <= MAX_TEXT_KEY_LENGTH && !id.includes('\u0000'),
}

/** Conversión del parámetro al tipo de la columna clave. */
const KEY_CASTS: Readonly<Record<SnapshotKeyType, Prisma.Sql>> = {
  uuid: Prisma.sql`::uuid`,
  integer: Prisma.sql`::integer`,
  text: Prisma.sql`::text`,
}

/**
 * Nombre de tabla o de columna entre comillas, para la consulta.
 *
 * @throws {TypeError} En español, si no es un identificador simple (error de programación: los
 *   nombres salen solo de la tabla estática de descriptores).
 */
function identifier(name: string): Prisma.Sql {
  if (!IDENTIFIER.test(name)) {
    throw new TypeError(`"${name}" no es un nombre de tabla o de columna de la auditoría`)
  }
  return Prisma.raw(`"${name}"`)
}

/**
 * Tabla `audit_logs` y lectura genérica de la fila principal de una entidad (`to_jsonb`) para las
 * fotos de antes y de después. Los nombres de tabla y de columna vienen de la tabla estática de
 * descriptores y el id va siempre como parámetro de la consulta.
 */
@Injectable()
export class PrismaAuditLogRepository implements AuditLogRepository {
  /** @param prisma - Cliente de Prisma de la app. */
  constructor(private readonly prisma: PrismaService) {}

  /** {@inheritDoc AuditLogRepository.readRow} */
  async readRow(source: SnapshotSource, id: string): Promise<JsonRow | null> {
    const table = identifier(source.table)
    const column = identifier(source.keyColumn)
    if (!KEY_SHAPES[source.keyType](id)) return null
    const rows = await this.prisma.$queryRaw<{ row: JsonRow }[]>`
      SELECT to_jsonb(t) AS "row" FROM ${table} AS t
      WHERE t.${column} = ${id}${KEY_CASTS[source.keyType]}
      LIMIT 1`
    return rows[0]?.row ?? null
  }

  /** {@inheritDoc AuditLogRepository.append} */
  async append(entry: NewAuditEntry): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        actorUserId: entry.actorUserId,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        // Ida y vuelta por JSON: lo que se guarda es JSON puro (sin `undefined`).
        changes: JSON.parse(JSON.stringify(entry.changes)) as Prisma.InputJsonObject,
      },
    })
  }
}
