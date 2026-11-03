import type { Province } from '../../identity/domain/province'
import type { ShippingMethod, ShippingOption } from '../../settings/domain/store-settings.entity'
import { CartValidationError, ShippingMethodUnavailableError } from './orders-errors'

/** Dirección completa de un envío a domicilio (`AddressInput` del contrato). */
export interface HomeAddress {
  /** Calle. */
  street: string
  /** Número, o `S/N`. */
  number: string
  /** Piso o departamento, o `null`. */
  apartment: string | null
  /** Código postal. */
  postalCode: string
  /** Ciudad o localidad. */
  city: string
  /** Provincia. */
  province: Province
}

/** Destino de un envío a sucursal (`BranchAddressInput` del contrato). */
export interface BranchAddress {
  /** Código postal. */
  postalCode: string
  /** Ciudad o localidad. */
  city: string
  /** Provincia. */
  province: Province
}

/** Destino de un envío (`ShippingAddress` del contrato): completo en `home`, parcial en `branch`. */
export type ShippingAddress = HomeAddress | BranchAddress

/**
 * Indica si un destino es una dirección completa de domicilio.
 *
 * @param address - Destino.
 * @returns `true` si tiene calle (es un {@link HomeAddress}).
 */
export function isHomeAddress(address: ShippingAddress): address is HomeAddress {
  return 'street' in address
}

/**
 * Destino que se copia al pedido según el método: la dirección completa en `home`, solo código
 * postal, ciudad y provincia en `branch`, y `null` en `pickup` (se descarta la que llegue de más).
 *
 * @param method - Método de envío.
 * @param address - Destino que mandó el checkout.
 * @returns El destino a guardar.
 * @throws {TypeError} En español, si `home` no trae una dirección completa o `branch` no trae
 *   destino.
 */
export function orderShippingAddress(
  method: ShippingMethod,
  address: ShippingAddress | null,
): ShippingAddress | null {
  if (method === 'pickup') return null
  if (address === null) {
    throw new TypeError(`El envío "${method}" necesita un destino`)
  }
  const { postalCode, city, province } = address
  if (method === 'branch') return { postalCode, city, province }
  if (!isHomeAddress(address)) {
    throw new TypeError('El envío a domicilio necesita la dirección completa')
  }
  const { street, number, apartment } = address
  return { street, number, apartment, postalCode, city, province }
}

/**
 * Busca la opción de envío del método y comprueba que esté habilitada.
 *
 * @param options - Opciones de envío de los ajustes.
 * @param method - Método elegido.
 * @param field - Campo del método para el error: `shipping.method` o `method`.
 * @returns La opción, con su costo y su plazo.
 * @throws {ShippingMethodUnavailableError} Si el método no está o está deshabilitado.
 */
export function findShippingOption(
  options: readonly ShippingOption[],
  method: ShippingMethod,
  field: 'shipping.method' | 'method',
): ShippingOption {
  const option = options.find((candidate) => candidate.method === method)
  if (option?.enabled !== true) throw new ShippingMethodUnavailableError(field)
  return option
}

/**
 * Exige el código postal salvo en el retiro en persona (`POST /shipping/quote`).
 *
 * @param method - Método elegido.
 * @param postalCode - Código postal, o `null`.
 * @throws {CartValidationError} 422 en `postalCode` (`Ingresá el código postal.`).
 */
export function requirePostalCode(method: ShippingMethod, postalCode: string | null): void {
  if (method !== 'pickup' && postalCode === null) {
    throw new CartValidationError([
      { field: 'postalCode', code: 'required', message: 'Ingresá el código postal.' },
    ])
  }
}
