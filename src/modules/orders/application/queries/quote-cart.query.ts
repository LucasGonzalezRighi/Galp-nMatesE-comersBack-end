import { type CartItem, cartProductIds } from '../../domain/cart-line'
import { CartValidationError } from '../../domain/orders-errors'
import { type CartQuote, priceCart } from '../../domain/pricing'
import type { ExpireOrdersCommand } from '../commands/expire-orders.command'
import type { ProductCatalogPort } from '../ports/product-catalog.port'
import type { StoreSettingsPort } from '../ports/store-settings.port'

/**
 * Cotización del carrito (`POST /cart/quote`): importes, ahorro por kit y disponibilidad de cada
 * línea con los precios y el stock vigentes. No reserva nada.
 */
export class QuoteCartQuery {
  /**
   * @param catalog - Productos con su stock libre.
   * @param settings - Descuento del kit, IVA y si se muestran los netos.
   * @param expire - Vencimiento de los pedidos atrasados (libera su stock antes de cotizar).
   */
  constructor(
    private readonly catalog: ProductCatalogPort,
    private readonly settings: StoreSettingsPort,
    private readonly expire: ExpireOrdersCommand,
  ) {}

  /**
   * @param items - Líneas del carrito (de 1 a 50).
   * @returns La cotización, con las líneas en el orden del carrito.
   * @throws {CartValidationError} 422 si un mate llega sin cuero ni virola, o si el total pasa
   *   del máximo.
   * @throws {RangeError} En español, si las líneas o las cantidades están fuera de rango.
   */
  async execute(items: CartItem[]): Promise<CartQuote> {
    await this.expire.expireDue()
    const settings = await this.settings.get()
    const products = await this.catalog.findForCart(cartProductIds(items))
    const priced = priceCart(
      items,
      new Map(products.map((product) => [product.id, product])),
      settings,
    )
    if (priced.optionErrors.length > 0) throw new CartValidationError(priced.optionErrors)
    return priced.quote
  }
}
