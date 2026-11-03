import { ApiProperty, ApiSchema } from '@nestjs/swagger'
import { Expose, Transform, type TransformFnParams, Type } from 'class-transformer'
import {
  IsDefined,
  IsIn,
  IsInt,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator'

import { RawValue } from '../../../identity/interface/dto/identity-fields'
import { ApiSchemaProperty, namedRef } from '../../../../shared/infrastructure/http/openapi'
import type { CreateOrderInput } from '../../application/commands/create-order.command'
import { PAYMENT_METHODS, type PaymentMethod } from '../../domain/order-status'
import { MAX_TOTAL_ARS } from '../../domain/pricing'
import { type CartItemInputDto, CartItemsField, toCartItem } from './cart-item-input.dto'
import { CustomerInputDto } from './customer-input.dto'
import { ShippingInputDto, toShippingInput } from './shipping-input.dto'

/** Textos de error del pedido que no son de un campo de contacto, envío o línea. */
export const ORDER_INPUT_MESSAGES = {
  /** Falta el contacto o no es un objeto. */
  customer: 'Completá tus datos de contacto.',
  /** Falta el envío o no es un objeto. */
  shipping: 'Elegí cómo querés recibir el pedido.',
  /** Forma de pago que no es `mp_redirect` ni `card`. */
  paymentMethod: 'Elegí una forma de pago.',
  /** Total esperado que no es un entero de 0 a 2.147.483.647. */
  expectedTotal: 'El total esperado tiene que ser un número entero.',
  /** Honeypot que no es texto o es demasiado largo. */
  website: 'Este campo tiene que quedar vacío.',
} as const

/** Largo máximo que se acepta en el honeypot (con texto igual se descarta en silencio). */
const HONEYPOT_MAX_LENGTH = 200

/** Honeypot crudo: ausente queda `null`; `''`, `null` y el texto llegan tal cual. */
function toHoneypot({ obj, key }: TransformFnParams): unknown {
  const value = (obj as Record<string, unknown>)[key]
  return value === undefined ? null : value
}

/**
 * Pedido que arma el checkout (`CreateOrderInput` del contrato). El back recalcula todos los
 * importes; `expectedTotalArs` es el total que vio la persona, para avisarle si cambió.
 */
@ApiSchema({ name: 'CreateOrderInput' })
export class CreateOrderInputDto {
  /** Contacto de quien compra. */
  @ApiProperty({ type: () => CustomerInputDto })
  @IsDefined({ message: ORDER_INPUT_MESSAGES.customer })
  @ValidateNested({ message: ORDER_INPUT_MESSAGES.customer })
  @Type(() => CustomerInputDto)
  customer!: CustomerInputDto

  /** Envío elegido. */
  @ApiProperty({ type: () => ShippingInputDto })
  @IsDefined({ message: ORDER_INPUT_MESSAGES.shipping })
  @ValidateNested({ message: ORDER_INPUT_MESSAGES.shipping })
  @Type(() => ShippingInputDto)
  shipping!: ShippingInputDto

  /** Líneas del carrito, de 1 a 50. */
  @CartItemsField()
  items!: CartItemInputDto[]

  /** Forma de pago. */
  @ApiSchemaProperty(namedRef('PaymentMethod'))
  @RawValue()
  @IsIn(PAYMENT_METHODS, { message: ORDER_INPUT_MESSAGES.paymentMethod })
  paymentMethod!: PaymentMethod

  /** Total con el envío que vio la persona en el resumen. */
  @ApiSchemaProperty(namedRef('TotalArs'))
  @RawValue()
  @Max(MAX_TOTAL_ARS, { message: ORDER_INPUT_MESSAGES.expectedTotal })
  @Min(0, { message: ORDER_INPUT_MESSAGES.expectedTotal })
  @IsInt({ message: ORDER_INPUT_MESSAGES.expectedTotal })
  expectedTotalArs!: number

  /** Campo trampa: `''`, `null` o ausente para las personas; con texto, es un bot. */
  @ApiSchemaProperty(namedRef('Honeypot'))
  @Expose()
  @Transform(toHoneypot)
  @ValidateIf((_object, value) => value !== null)
  @MaxLength(HONEYPOT_MAX_LENGTH, { message: ORDER_INPUT_MESSAGES.website })
  @IsString({ message: ORDER_INPUT_MESSAGES.website })
  website!: string | null

  /**
   * El pedido para `CreateOrderCommand`.
   *
   * @returns Contacto, envío y líneas del dominio, forma de pago, total esperado y honeypot.
   */
  toInput(): CreateOrderInput {
    return {
      customer: this.customer.toContact(),
      shipping: toShippingInput(this.shipping),
      items: this.items.map(toCartItem),
      paymentMethod: this.paymentMethod,
      expectedTotalArs: this.expectedTotalArs,
      website: this.website,
    }
  }
}
