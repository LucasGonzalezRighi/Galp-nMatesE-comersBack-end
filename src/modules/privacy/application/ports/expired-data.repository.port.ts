import type { PurgeTarget } from '../../domain/retention'

/**
 * Borrado de datos vencidos. Cada tipo sabe cuál es su fecha de referencia y qué filas nunca se
 * tocan (arrepentimientos en `contact_messages`, reseñas aprobadas).
 */
export interface ExpiredDataRepository {
  /**
   * Borra hasta `limit` filas de `target` con su fecha de referencia anterior a `cutoff`.
   *
   * @param target - El tipo de dato.
   * @param cutoff - La fecha de corte.
   * @param limit - El tamaño del lote.
   * @returns Cuántas filas borró.
   */
  deleteBatch(target: PurgeTarget, cutoff: Date, limit: number): Promise<number>
}

/** Token de inyección de {@link ExpiredDataRepository}. */
export const EXPIRED_DATA_REPOSITORY = Symbol('EXPIRED_DATA_REPOSITORY')
