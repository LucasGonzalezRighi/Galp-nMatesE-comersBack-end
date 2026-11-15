import type { Address, AddressInput } from '../../domain/address.entity'

/** Dirección nueva de la libreta; el id lo genera la app (UUID v7). */
export interface NewAddress extends AddressInput {
  /** Id de la dirección. */
  id: string
  /** Cliente dueño. */
  customerId: string
}

/**
 * Libreta de direcciones (la tabla `addresses`). Cada cliente tiene a lo sumo una predeterminada:
 * `create` y `replace` con `isDefault: true` le quitan la marca a la anterior en la misma
 * transacción.
 */
export interface AddressRepository {
  /**
   * Direcciones de un cliente: la predeterminada primero y después por orden de alta.
   *
   * @param customerId - Id del cliente.
   */
  listByCustomer(customerId: string): Promise<Address[]>

  /**
   * Busca una dirección de un cliente.
   *
   * @param customerId - Id del cliente.
   * @param id - Id de la dirección.
   * @returns La dirección, o `null` si no existe o es de otro cliente.
   */
  findOne(customerId: string, id: string): Promise<Address | null>

  /**
   * Agrega una dirección, si el cliente tiene menos de `MAX_ADDRESSES_PER_CUSTOMER` (NV-30; el
   * conteo y el alta van juntos, así dos altas a la vez no pasan el tope).
   *
   * @param input - Dirección con su id y su dueño.
   * @returns La dirección creada.
   * @throws {AddressBookFullError} 422 si la libreta ya está llena.
   */
  create(input: NewAddress): Promise<Address>

  /**
   * Reemplaza todos los datos de una dirección (conserva id y dueño).
   *
   * @param id - Id de la dirección.
   * @param input - Datos nuevos.
   * @returns La dirección actualizada.
   */
  replace(id: string, input: AddressInput): Promise<Address>

  /**
   * Borra una dirección.
   *
   * @param id - Id de la dirección.
   */
  delete(id: string): Promise<void>
}

/** Token de inyección del {@link AddressRepository}. */
export const ADDRESS_REPOSITORY = Symbol('ADDRESS_REPOSITORY')
