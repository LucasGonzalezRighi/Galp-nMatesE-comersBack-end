import { ComboNotFoundError, ComboValidationError } from '../../domain/combo-errors'
import { comboChangedEvent } from '../../domain/combo-events'
import { assertComboFields, comboFieldErrors } from '../combo-rules'
import { toComboView } from '../combo-views'
import type { ComboFields, ComboRepository } from '../ports/combo.repository.port'
import type { PriceDisplayPort } from '../ports/price-display.port'
import type { ComboView } from '../read-models'

/** Modificación de un combo desde el dashboard (`PATCH /admin/combos/{id}`). */
export class UpdateComboCommand {
  /**
   * @param combos - Combos guardados.
   * @param prices - Ajustes de precios (precio sin IVA de la respuesta).
   */
  constructor(
    private readonly combos: ComboRepository,
    private readonly prices: PriceDisplayPort,
  ) {}

  /**
   * Reemplaza los datos y las piezas del combo (conserva su `position`), con su evento
   * `combo.changed` (`updated`) en la misma transacción. Primero busca el combo y después lo
   * valida con la base, como el mock.
   *
   * @param id - Id del combo (uno que no es UUID no existe).
   * @param fields - Datos del combo completo, con la forma ya validada.
   * @returns El combo modificado, con la forma `Combo` del contrato.
   * @throws {ComboNotFoundError} 404 si no existe.
   * @throws {ComboValidationError} 422 si un producto no se vende, si dos son del mismo grupo o
   *   si el precio no queda por debajo de la suma.
   * @throws {TypeError | RangeError} En español, si los datos no tienen la forma de `ComboInput`.
   */
  async execute(id: string, fields: ComboFields): Promise<ComboView> {
    assertComboFields(fields)
    if ((await this.combos.findById(id)) === null) throw new ComboNotFoundError()
    const products = await this.combos.findProducts(fields.productIds)
    const errors = comboFieldErrors(fields, products)
    if (errors.length > 0) throw new ComboValidationError(errors)
    const [updated, prices] = await Promise.all([
      this.combos.update(id, fields, comboChangedEvent('updated', id)),
      this.prices.get(),
    ])
    if (updated === null) throw new ComboNotFoundError()
    return toComboView(updated, prices)
  }
}
