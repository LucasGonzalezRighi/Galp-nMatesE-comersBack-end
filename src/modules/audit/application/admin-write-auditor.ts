import { type AdminWriteTarget, entityIdOf } from '../domain/admin-write'
import {
  auditInput,
  buildChanges,
  diffSnapshot,
  type JsonRow,
  type SnapshotDiff,
} from '../domain/audit-changes'
import type { AuditFailureLog } from './ports/audit-failure-log.port'
import type { AuditLogRepository } from './ports/audit-log.repository.port'

/** Escritura del dashboard que se va a auditar, como la ve el interceptor antes del handler. */
export interface AdminWrite {
  /** Cómo se audita la ruta (`resolveAdminWrite`). */
  readonly target: AdminWriteTarget
  /** Usuario admin de la sesión. */
  readonly actorUserId: string
  /** Parámetros de la ruta. */
  readonly params: Readonly<Record<string, unknown>>
  /** Cuerpo del pedido, o `undefined` si no mandó. */
  readonly body: unknown
}

/** Lo que {@link AdminWriteAuditor.begin} deja listo para {@link AdminWriteAuditor.complete}. */
export interface PendingAudit {
  /** La escritura. */
  readonly write: AdminWrite
  /** Fila principal antes del handler; `null` si no existía, no se sabía el id o no se lee. */
  readonly before: JsonRow | null
  /** `false` si la lectura de antes falló: la fila de auditoría sale sin foto. */
  readonly snapshotAvailable: boolean
}

/** Nombre y código del error (por ejemplo `PrismaClientKnownRequestError P2003`), sin su mensaje. */
function describeError(error: unknown): string {
  if (!(error instanceof Error)) return typeof error
  const code: unknown = Reflect.get(error, 'code')
  return typeof code === 'string' ? `${error.name} ${code}` : error.name
}

/**
 * Deja una fila en `audit_logs` por cada escritura exitosa del dashboard, en dos pasos alrededor
 * del handler: {@link begin} lee la fila principal antes y {@link complete} la vuelve a leer y
 * guarda quién, qué, sobre qué entidad y qué cambió.
 *
 * Ninguno de los dos lanza: si falla una lectura o el guardado, la escritura del admin no se
 * revierte ni cambia su respuesta; queda un error en el log con la acción y la entidad. Si falla
 * una lectura, la fila de auditoría se guarda igual, sin la foto.
 */
export class AdminWriteAuditor {
  /**
   * @param auditLog - Tabla `audit_logs` y lectura de las filas.
   * @param log - Dónde quedan los errores de la auditoría.
   */
  constructor(
    private readonly auditLog: AuditLogRepository,
    private readonly log: AuditFailureLog,
  ) {}

  /**
   * Antes del handler: si la ruta tiene foto y el id ya se sabe, lee la fila principal.
   *
   * @param write - La escritura que está por correr.
   * @returns Lo que necesita {@link complete}.
   */
  async begin(write: AdminWrite): Promise<PendingAudit> {
    const { snapshot } = write.target
    if (snapshot === null) return { write, before: null, snapshotAvailable: true }
    let entityId: string | null = null
    try {
      entityId = entityIdOf(write.target.entityId, write)
      const before = entityId === null ? null : await this.auditLog.readRow(snapshot, entityId)
      return { write, before, snapshotAvailable: true }
    } catch (error) {
      this.fail('No se pudo leer la fila de antes para la auditoría', write, entityId, error)
      return { write, before: null, snapshotAvailable: false }
    }
  }

  /**
   * Después de que el handler respondió bien: lee la fila otra vez, arma `changes` y guarda la
   * fila de auditoría. Quien lo llama lo espera antes de mandar la respuesta.
   *
   * @param pending - Lo que devolvió {@link begin}.
   * @param response - Cuerpo de la respuesta del handler (de un alta sale el id).
   */
  async complete(pending: PendingAudit, response: unknown): Promise<void> {
    const { write } = pending
    const { target } = write
    let entityId: string | null = null
    try {
      entityId = entityIdOf(target.entityId, { ...write, response })
      const snapshot = await this.snapshotOf(pending, entityId)
      await this.auditLog.append({
        actorUserId: write.actorUserId,
        action: target.action,
        entityType: target.entityType,
        entityId,
        changes: buildChanges(target.storesInput ? auditInput(write.body) : undefined, snapshot),
      })
    } catch (error) {
      this.fail('No se pudo guardar la auditoría', write, entityId, error)
    }
  }

  /** La foto de la escritura, o `null` si la ruta no tiene, no hay id o una lectura falló. */
  private async snapshotOf(
    pending: PendingAudit,
    entityId: string | null,
  ): Promise<SnapshotDiff | null> {
    const { snapshot } = pending.write.target
    if (snapshot === null || entityId === null || !pending.snapshotAvailable) return null
    try {
      const after = await this.auditLog.readRow(snapshot, entityId)
      return diffSnapshot(pending.before, after, snapshot.personalData)
    } catch (error) {
      const what = 'No se pudo leer la fila de después para la auditoría'
      this.fail(what, pending.write, entityId, error)
      return null
    }
  }

  /** Deja el error en el log: acción, entidad y nombre del error; nunca el cuerpo ni el mensaje. */
  private fail(what: string, write: AdminWrite, entityId: string | null, error: unknown): void {
    const { action, entityType } = write.target
    const entity = entityId === null ? entityType : `${entityType} ${entityId}`
    this.log.error(`${what} de ${action} (${entity}): ${describeError(error)}`)
  }
}
