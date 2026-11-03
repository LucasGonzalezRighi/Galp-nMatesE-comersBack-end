import type { NewDomainEvent } from '../../../shared/domain/domain-event'

/** Tipo de agregado de los eventos de combos. */
export const COMBO_AGGREGATE = 'combo'

/** Evento de combos cambiados desde el dashboard (la tienda regenera la etiqueta `combos`). */
export const COMBO_CHANGED_EVENT = 'combo.changed'

/** Qué escritura del dashboard cambió los combos. */
export type ComboChange = 'created' | 'updated' | 'deleted' | 'reordered'

/** Agregado de un reordenamiento, que toca todos los combos. */
const ALL_COMBOS_AGGREGATE_ID = 'combos'

const COMBO_CHANGES: readonly ComboChange[] = ['created', 'updated', 'deleted', 'reordered']

/**
 * Evento `combo.changed` para el outbox: va en la misma transacción de cada escritura de combos.
 *
 * @param change - Qué escritura fue.
 * @param comboId - Id del combo; `null` solo en `reordered`, que toca todos (el agregado es
 *   `'combos'`).
 * @returns El evento con `{ comboId, change }`.
 * @throws {RangeError} En español, si `change` no es uno de los cuatro cambios.
 * @throws {TypeError} En español, si `comboId` está vacío o falta en un cambio de un solo combo.
 */
export function comboChangedEvent(change: ComboChange, comboId: string | null): NewDomainEvent {
  if (!COMBO_CHANGES.includes(change)) {
    throw new RangeError(
      `El cambio de combos tiene que ser created, updated, deleted o reordered (llegó ${change})`,
    )
  }
  if (comboId === null && change !== 'reordered') {
    throw new TypeError(`El cambio ${change} de combos necesita el id del combo`)
  }
  if (comboId?.trim() === '') {
    throw new TypeError('El id del combo no puede estar vacío')
  }
  return {
    type: COMBO_CHANGED_EVENT,
    aggregateType: COMBO_AGGREGATE,
    aggregateId: comboId ?? ALL_COMBOS_AGGREGATE_ID,
    payload: { comboId, change },
  }
}
