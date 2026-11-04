import { newId } from '../../../../shared/domain/id'
import { ComboValidationError } from '../../domain/combo-errors'
import { comboChangedEvent } from '../../domain/combo-events'
import { assertComboFields, canonicalComboFields, comboFieldErrors } from '../combo-rules'
import { toComboView } from '../combo-views'
import type { ComboFields, ComboRepository } from '../ports/combo.repository.port'
import type { PriceDisplayPort } from '../ports/price-display.port'
import type { ComboView } from '../read-models'

/** Alta de un combo desde el dashboard (`POST /admin/combos`). */
export class CreateComboCommand {
  /**
   * @param combos - Combos guardados.
   * @param prices - Ajustes de precios (precio sin IVA de la respuesta).
   */
  constructor(
    private readonly combos: ComboRepository,
    private readonly prices: PriceDisplayPort,
  ) {}

  /**
   * Valida el combo con la base y lo crea al final del listado, con su evento `combo.changed`
   * (`created`) en la misma transacción.
   *
   * @param fields - Datos del combo, con la forma ya validada (un UUID en mayúsculas se guarda en
   *   minúsculas).
   * @returns El combo creado, con la forma `Combo` del contrato.
   * @throws {ComboValidationError} 422 si un producto no se vende, si dos son del mismo grupo o
   *   si el precio no queda por debajo de la suma.
   * @throws {TypeError | RangeError} En español, si los datos no tienen la forma de `ComboInput`.
   */
  async execute(fields: ComboFields): Promise<ComboView> {
    assertComboFields(fields)
    const input = canonicalComboFields(fields)
    const products = await this.combos.findProducts(input.productIds)
    const errors = comboFieldErrors(input, products)
    if (errors.length > 0) throw new ComboValidationError(errors)
    const id = newId()
    const [created, prices] = await Promise.all([
      this.combos.create(id, input, comboChangedEvent('created', id)),
      this.prices.get(),
    ])
    return toComboView(created, prices)
  }
}
