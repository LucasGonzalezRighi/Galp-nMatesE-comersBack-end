import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common'
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import { SkipThrottle } from '@nestjs/throttler'

import { ApiProblemResponses } from '../../../shared/infrastructure/http/openapi'
import { QuoteCartQuery } from '../application/queries/quote-cart.query'
import { QuoteShippingQuery } from '../application/queries/quote-shipping.query'
import type { CartQuote, ShippingQuote } from '../application/read-models'
import { CartQuoteInputDto } from './dto/cart-quote-input.dto'
import { CartQuoteDto, ShippingQuoteDto } from './dto/orders.response.dto'
import { ShippingQuoteInputDto } from './dto/shipping-quote-input.dto'

/**
 * Cotizaciones del carrito y del envío (`/cart/quote` y `/shipping/quote`): públicas, sin sesión
 * ni CSRF (`security: []`; un `X-CSRF-Token` que llegue se ignora). No reservan nada. Sin límite
 * por IP (Ruling B-27): toda la tienda llega desde la IP del servidor Next y el carrito cotiza en
 * cada cambio.
 */
@ApiTags('cart')
@SkipThrottle()
@Controller()
export class CartController {
  /**
   * @param quoteCart - Cotización del carrito.
   * @param quoteShipping - Cotización del envío.
   */
  constructor(
    private readonly quoteCart: QuoteCartQuery,
    private readonly quoteShipping: QuoteShippingQuery,
  ) {}

  /**
   * Cotiza las líneas del carrito con los precios y el stock vigentes.
   *
   * @param body - Líneas del carrito, ya validadas.
   * @returns Importes, ahorro por kit y disponibilidad de cada línea, en el orden del carrito.
   * @throws {CartValidationError} 422 si falta el cuero de un mate con cueros, si el mate no lo
   *   ofrece o si el total es enorme.
   */
  @Post('cart/quote')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ operationId: 'quoteCart', summary: 'Cotizar el carrito' })
  @ApiOkResponse({ type: CartQuoteDto, description: 'Cotización del carrito.' })
  @ApiProblemResponses(422, 429, 500)
  quote(@Body() body: CartQuoteInputDto): Promise<CartQuote> {
    return this.quoteCart.execute(body.toItems())
  }

  /**
   * Devuelve el costo y el plazo del envío de un método (fijos por método).
   *
   * @param body - Método, código postal y líneas, ya validados.
   * @returns Método, costo y plazo.
   * @throws {CartValidationError} 422 si falta el código postal (salvo en el retiro) o el método
   *   está deshabilitado.
   */
  @Post('shipping/quote')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ operationId: 'quoteShipping', summary: 'Cotizar el envío' })
  @ApiOkResponse({ type: ShippingQuoteDto, description: 'Costo y plazo del envío.' })
  @ApiProblemResponses(422, 429, 500)
  shipping(@Body() body: ShippingQuoteInputDto): Promise<ShippingQuote> {
    return this.quoteShipping.execute(body.toInput())
  }
}
