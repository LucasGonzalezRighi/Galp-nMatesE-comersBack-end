import { canonicalId } from '../../../../shared/domain/id'
import { ComboNotFoundError } from '../../domain/combo-errors'
import { comboChangedEvent } from '../../domain/combo-events'
import type { ComboRepository } from '../ports/combo.repository.port'

/** Baja de un combo desde el dashboard (`DELETE /admin/combos/{id}`). */
export class DeleteComboCommand {
  /** @param combos - Combos guardados. */
  constructor(private readonly combos: ComboRepository) {}

  /**
   * Borra el combo y renumera los demás de 1 en adelante, con su evento `combo.changed`
   * (`deleted`) en la misma transacción. Los pedidos que lo compraron no cambian (guardan su
   * copia).
   *
   * @param id - Id del combo (uno vacío o que no es UUID no existe; uno en mayúsculas es el
   *   mismo).
   * @throws {ComboNotFoundError} 404 si no existe.
   */
  async execute(id: string): Promise<void> {
    if (id.trim() === '') throw new ComboNotFoundError()
    const comboId = canonicalId(id)
    const deleted = await this.combos.delete(comboId, comboChangedEvent('deleted', comboId))
    if (!deleted) throw new ComboNotFoundError()
  }
}
