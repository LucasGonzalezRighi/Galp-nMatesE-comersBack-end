import { canonicalId } from '../../../../shared/domain/id'
import { ComboValidationError } from '../../domain/combo-errors'
import { comboChangedEvent } from '../../domain/combo-events'
import { comboOrderErrors } from '../combo-rules'
import type { ComboRepository } from '../ports/combo.repository.port'

/** Orden de los combos desde el dashboard (`PUT /admin/combos/order`). */
export class ReorderCombosCommand {
  /** @param combos - Combos guardados. */
  constructor(private readonly combos: ComboRepository) {}

  /**
   * Fija `position` = lugar de cada combo en `ids` (desde 1), con un evento `combo.changed`
   * (`reordered`) de todos los combos en la misma transacción.
   *
   * @param ids - Todos los combos, una vez cada uno, en el orden nuevo (un UUID en mayúsculas es
   *   el mismo combo).
   * @throws {ComboValidationError} 422 en `ids` si falta un combo, sobra uno, se repite o no
   *   existe.
   */
  async execute(ids: readonly string[]): Promise<void> {
    const order = ids.map(canonicalId)
    const errors = comboOrderErrors(order, await this.combos.listIds())
    if (errors.length > 0) throw new ComboValidationError(errors)
    await this.combos.reorder(order, comboChangedEvent('reordered', null))
  }
}
