import { IsString, Matches } from 'class-validator'

import { ORDER_NUMBER_PATTERN } from '../../domain/order-number'

/** Error de un número de pedido mal formado (el del mock del front). */
export const INVALID_ORDER_NUMBER_MESSAGE =
  'El número de pedido tiene que ser GLP- y cinco dígitos.'

/**
 * Número de pedido de la ruta (parámetro `OrderNumber` del contrato): `GLP-` y cinco dígitos, sin
 * recortar ni cambiar mayúsculas. Si no tiene el formato, el pipe global responde 422 en `number`
 * con `invalid_format`. Swagger lo declara con `@ApiParam` (ver `ORDER_NUMBER_PARAM`).
 */
export class OrderNumberParamDto {
  /** Número del pedido. */
  @Matches(ORDER_NUMBER_PATTERN, { message: INVALID_ORDER_NUMBER_MESSAGE })
  @IsString({ message: INVALID_ORDER_NUMBER_MESSAGE })
  number = ''
}
