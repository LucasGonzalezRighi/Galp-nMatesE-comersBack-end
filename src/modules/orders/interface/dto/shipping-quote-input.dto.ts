import { ApiSchema } from '@nestjs/swagger'
import { IsIn, Matches, ValidateIf } from 'class-validator'

import {
  IDENTITY_MESSAGES,
  POSTAL_CODE_PATTERN,
  Trimmed,
} from '../../../identity/interface/dto/identity-fields'
import {
  type ShippingMethod,
  SHIPPING_METHODS,
} from '../../../settings/domain/store-settings.entity'
import {
  ApiSchemaProperty,
  namedRef,
  nullableRef,
} from '../../../../shared/infrastructure/http/openapi'
import type { QuoteShippingInput } from '../../application/queries/quote-shipping.query'
import { type CartItemInputDto, CartItemsField, toCartItem } from './cart-item-input.dto'
import { SHIPPING_METHOD_MESSAGE } from './shipping-input.dto'

/**
 * Cuerpo de `POST /shipping/quote` (`ShippingQuoteInput` del contrato). `postalCode` puede ser
 * `null` (o faltar); si falta y el método no es `pickup`, el caso de uso responde 422.
 */
@ApiSchema({ name: 'ShippingQuoteInput' })
export class ShippingQuoteInputDto {
  /** Método de envío. */
  @ApiSchemaProperty(namedRef('ShippingMethod'))
  @IsIn(SHIPPING_METHODS, { message: SHIPPING_METHOD_MESSAGE })
  method!: ShippingMethod

  /** Código postal de destino, en mayúsculas, o `null` en el retiro en persona. */
  @ApiSchemaProperty(nullableRef('PostalCode'))
  @Trimmed('upper')
  @ValidateIf((_object, value) => value !== null && value !== undefined)
  @Matches(new RegExp(POSTAL_CODE_PATTERN), { message: IDENTITY_MESSAGES.invalidPostalCode })
  postalCode?: string | null

  /** Líneas del carrito (solo se validan). */
  @CartItemsField()
  items!: CartItemInputDto[]

  /**
   * Los datos para `QuoteShippingQuery`.
   *
   * @returns Método, código postal (`null` si no vino) y líneas del dominio.
   */
  toInput(): QuoteShippingInput {
    return {
      method: this.method,
      postalCode: this.postalCode ?? null,
      items: this.items.map(toCartItem),
    }
  }
}
