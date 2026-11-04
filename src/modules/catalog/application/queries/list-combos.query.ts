import { isComboForSale, toComboView } from '../combo-views'
import type { ComboRepository } from '../ports/combo.repository.port'
import type { PriceDisplayPort } from '../ports/price-display.port'
import type { ComboView } from '../read-models'

/** Combos a la venta de la tienda (`GET /combos`). */
export class ListCombosQuery {
  /**
   * @param combos - Combos guardados (sin caché).
   * @param prices - Ajustes de precios (precio sin IVA).
   */
  constructor(
    private readonly combos: ComboRepository,
    private readonly prices: PriceDisplayPort,
  ) {}

  /**
   * Lista los combos publicados cuyas piezas están todas publicadas, con precio y son de grupos
   * distintos, por `position`. Los que tienen una pieza sin stock vienen con `isSoldOut`.
   *
   * @returns Los combos con la forma `Combo` del contrato.
   */
  async execute(): Promise<ComboView[]> {
    const [combos, prices] = await Promise.all([this.combos.list(), this.prices.get()])
    return combos.filter(isComboForSale).map((stored) => toComboView(stored, prices))
  }
}
