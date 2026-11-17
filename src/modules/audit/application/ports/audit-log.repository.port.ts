import type { SnapshotSource } from '../../domain/admin-write'
import type { AuditChanges, JsonRow } from '../../domain/audit-changes'

/** Fila nueva de `audit_logs`; el id y la fecha los pone la base. */
export interface NewAuditEntry {
  /** Usuario admin que hizo la escritura. */
  actorUserId: string
  /** `<entidad>.<verbo>`: `category.update`, `order.status`… */
  action: string
  /** Tipo de entidad: `category`, `order`, `content`… */
  entityType: string
  /** Id de la entidad, o `null` si la escritura no es sobre una sola. */
  entityId: string | null
  /** `{ input, before, after }`, sin las claves que no aplican. */
  changes: AuditChanges
}

/** Tabla `audit_logs` y la lectura de la fila principal de una entidad para las fotos. */
export interface AuditLogRepository {
  /**
   * Lee la fila principal de una entidad como JSON (columna → valor).
   *
   * @param source - Tabla y columna clave, siempre de la tabla estática de descriptores.
   * @param id - Id de la entidad, tal como llegó (nunca se concatena en la consulta).
   * @returns La fila, o `null` si no existe o si el id no tiene la forma de la columna (un id que
   *   no es un UUID no lanza).
   */
  readRow(source: SnapshotSource, id: string): Promise<JsonRow | null>

  /**
   * Guarda una fila de auditoría.
   *
   * @param entry - Quién, qué, sobre qué y qué cambió.
   */
  append(entry: NewAuditEntry): Promise<void>
}

/** Token de inyección del {@link AuditLogRepository}. */
export const AUDIT_LOG_REPOSITORY = Symbol('AUDIT_LOG_REPOSITORY')
