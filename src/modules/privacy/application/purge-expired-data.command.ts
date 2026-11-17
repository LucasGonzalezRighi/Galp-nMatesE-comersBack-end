import { PURGE_TARGETS, purgeCutoffs, type PurgeTarget } from '../domain/retention'
import type { ExpiredDataRepository } from './ports/expired-data.repository.port'

/** Filas que se borran por consulta. */
export const PURGE_BATCH_SIZE = 500

/** Cuántas filas borró la purga de cada tipo de dato. */
export type PurgeSummary = Record<PurgeTarget, number>

/**
 * Purga los datos personales vencidos según los plazos de `RETENTION`, de a lotes de
 * {@link PURGE_BATCH_SIZE}, un tipo de dato por vez.
 */
export class PurgeExpiredDataCommand {
  /** @param data - El borrado de datos vencidos. */
  constructor(private readonly data: ExpiredDataRepository) {}

  /**
   * @param now - El momento de la purga (el del reloj de la app).
   * @returns Cuántas filas borró de cada tipo de dato.
   * @throws Error si `now` no es una fecha válida (sin borrar nada).
   */
  async execute(now: Date): Promise<PurgeSummary> {
    const cutoffs = purgeCutoffs(now)
    const summary = Object.fromEntries(PURGE_TARGETS.map((target) => [target, 0])) as PurgeSummary
    for (const target of PURGE_TARGETS) {
      let deleted: number
      do {
        deleted = await this.data.deleteBatch(target, cutoffs[target], PURGE_BATCH_SIZE)
        summary[target] += deleted
      } while (deleted === PURGE_BATCH_SIZE)
    }
    return summary
  }
}
