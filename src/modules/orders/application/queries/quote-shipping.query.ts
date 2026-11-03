import type { ShippingMethod } from '../../../settings/domain/store-settings.entity'
import { type CartItem, MAX_CART_LINES } from '../../domain/cart-line'
import { findShippingOption, requirePostalCode } from '../../domain/shipping'
import type { StoreSettingsPort } from '../ports/store-settings.port'
import type { ShippingQuote } from '../read-models'

/** Datos para cotizar un envío (`ShippingQuoteInput` del contrato). */
export interface QuoteShippingInput {
  /** Método. */
  method: ShippingMethod
  /** Código postal, o `null` en el retiro en persona. */
  postalCode: string | null
  /** Líneas del carrito: solo se validan, no cambian el costo. */
  items: CartItem[]
}

/**
 * Cotización del envío (`POST /shipping/quote`): el costo y el plazo salen de las opciones de
 * envío de los ajustes y son fijos por método.
 */
export class QuoteShippingQuery {
  /** @param settings - Opciones de envío. */
  constructor(private readonly settings: StoreSettingsPort) {}

  /**
   * @param input - Método, código postal y líneas.
   * @returns Método, costo y plazo.
   * @throws {CartValidationError} 422 en `postalCode` si falta (salvo en el retiro) o en
   *   `method` si el método está deshabilitado.
   * @throws {RangeError} En español, si no hay líneas o hay más de 50.
   */
  async execute(input: QuoteShippingInput): Promise<ShippingQuote> {
    if (input.items.length < 1 || input.items.length > MAX_CART_LINES) {
      throw new RangeError(
        `El carrito tiene que tener de 1 a ${String(MAX_CART_LINES)} líneas (llegaron ${String(input.items.length)})`,
      )
    }
    requirePostalCode(input.method, input.postalCode)
    const { shippingOptions } = await this.settings.get()
    const option = findShippingOption(shippingOptions, input.method, 'method')
    return { method: option.method, costArs: option.costArs, eta: option.eta }
  }
}
