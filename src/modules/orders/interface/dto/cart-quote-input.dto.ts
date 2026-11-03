import { ApiSchema } from '@nestjs/swagger'

import type { CartItem } from '../../domain/cart-line'
import { type CartItemInputDto, CartItemsField, toCartItem } from './cart-item-input.dto'

/** Cuerpo de `POST /cart/quote` (`CartQuoteInput` del contrato): las líneas del carrito. */
@ApiSchema({ name: 'CartQuoteInput' })
export class CartQuoteInputDto {
  /** Líneas del carrito, de 1 a 50. */
  @CartItemsField()
  items!: CartItemInputDto[]

  /**
   * Las líneas para `QuoteCartQuery`.
   *
   * @returns Las líneas del dominio, en el orden del carrito.
   */
  toItems(): CartItem[] {
    return this.items.map(toCartItem)
  }
}
