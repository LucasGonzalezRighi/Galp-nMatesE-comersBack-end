import { ApiSchema } from '@nestjs/swagger'
import { Expose, Transform, type TransformFnParams, Type } from 'class-transformer'
import { IsIn, ValidateIf, ValidateNested } from 'class-validator'

import {
  type ShippingMethod,
  SHIPPING_METHODS,
} from '../../../settings/domain/store-settings.entity'
import { AddressInputDto } from '../../../../shared/infrastructure/http/address-input.dto'
import {
  ApiSchemaProperty,
  namedRef,
  nullableRef,
} from '../../../../shared/infrastructure/http/openapi'
import type { ShippingAddress } from '../../domain/shipping'
import { BranchAddressInputDto } from './branch-address-input.dto'

/** Error de un método de envío que no es `home`, `branch` ni `pickup`. */
export const SHIPPING_METHOD_MESSAGE = 'Elegí un método de envío.'

/** Error de una dirección que no es un objeto (no pasa: se valida como vacía, campo por campo). */
const ADDRESS_MESSAGE = 'Completá la dirección de envío.'

/** Indica si el método lleva destino: la dirección completa en `home`, parcial en `branch`. */
function needsAddress(method: unknown): method is 'home' | 'branch' {
  return method === 'home' || method === 'branch'
}

/** Clase del destino según el método del envío (el `oneOf` de `ShippingAddress`). */
function addressClassFor(
  shipping: Readonly<Record<string, unknown>> | undefined,
): typeof AddressInputDto | typeof BranchAddressInputDto {
  return shipping?.method === 'branch' ? BranchAddressInputDto : AddressInputDto
}

/**
 * Destino según el método, como `shippingSchema` del front: en `pickup` (o un método que no
 * existe) se descarta lo que llegue y queda `null`; en `home` y `branch` una dirección que falta,
 * es `null` o no es un objeto se valida como vacía, así cada campo pide su dato.
 */
function toAddressValue({ value, obj }: TransformFnParams): unknown {
  const method = (obj as Record<string, unknown>).method
  if (!needsAddress(method)) return null
  if (value instanceof AddressInputDto || value instanceof BranchAddressInputDto) return value
  return method === 'branch' ? new BranchAddressInputDto() : new AddressInputDto()
}

/** Envío elegido en el checkout (`ShippingInput` del contrato). */
@ApiSchema({ name: 'ShippingInput' })
export class ShippingInputDto {
  /** Método de envío. */
  @ApiSchemaProperty(namedRef('ShippingMethod'))
  @IsIn(SHIPPING_METHODS, { message: SHIPPING_METHOD_MESSAGE })
  method!: ShippingMethod

  /** Destino: completo en `home`, parcial en `branch` y `null` en `pickup`. */
  @ApiSchemaProperty(nullableRef('ShippingAddress'))
  @Expose()
  @Type((options) => addressClassFor(options?.object))
  @Transform(toAddressValue)
  @ValidateIf((shipping: ShippingInputDto) => needsAddress(shipping.method))
  @ValidateNested({ message: ADDRESS_MESSAGE })
  address!: AddressInputDto | BranchAddressInputDto | null
}

/** Envío del checkout para `CreateOrderCommand`. */
export interface ShippingInputValue {
  /** Método. */
  method: ShippingMethod
  /** Destino, o `null` en el retiro en persona. */
  address: ShippingAddress | null
}

/**
 * Pasa el envío validado al del dominio: copia solo los campos de cada destino y deja el piso
 * vacío (o ausente) en `null`.
 *
 * @param shipping - Envío ya validado por el pipe.
 * @returns El envío para el caso de uso.
 */
export function toShippingInput(
  shipping: Pick<ShippingInputDto, 'method' | 'address'>,
): ShippingInputValue {
  const { method, address } = shipping
  if (address === null || !needsAddress(method)) return { method, address: null }
  const { postalCode, city, province } = address
  if (method === 'branch' || !('street' in address)) {
    return { method, address: { postalCode, city, province } }
  }
  const apartment =
    address.apartment === undefined || address.apartment === '' ? null : address.apartment
  return {
    method,
    address: {
      street: address.street,
      number: address.number,
      apartment,
      postalCode,
      city,
      province,
    },
  }
}
