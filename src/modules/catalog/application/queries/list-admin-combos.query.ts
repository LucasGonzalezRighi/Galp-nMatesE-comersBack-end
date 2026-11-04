import { toComboView } from '../combo-views'
import type { ComboRepository } from '../ports/combo.repository.port'
import type { PriceDisplayPort } from '../ports/price-display.port'
import type { ComboView } from '../read-models'

/** Combos del dashboard (`GET /admin/combos`). */
export class ListAdminCombosQuery {
  /**
   * @param combos - Combos guardados (sin caché).
   * @param prices - Ajustes de precios (precio sin IVA).
   */
  constructor(
    private readonly combos: ComboRepository,
    private readonly prices: PriceDisplayPort,
  ) {}

  /**
   * Lista todos los combos, borradores incluidos, por `position`, con los datos vigentes de sus
   * piezas (así el dashboard ve los que no se pueden vender).
   *
   * @returns Los combos con la forma `Combo` del contrato.
   */
  async execute(): Promise<ComboView[]> {
    const [combos, prices] = await Promise.all([this.combos.list(), this.prices.get()])
    return combos.map((stored) => toComboView(stored, prices))
  }
}
