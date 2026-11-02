import type { Customer } from '../../domain/customer.entity'

/** Datos de un cliente nuevo; el id lo genera la app (UUID v7). */
export interface NewCustomer {
  /** Id del cliente. */
  id: string
  /** Usuario de su cuenta, o `null` si es un invitado. */
  userId: string | null
  /** Email normalizado. */
  email: string
  /** Nombre. */
  firstName: string
  /** Apellido. */
  lastName: string
  /** Teléfono, o `null`. */
  phone: string | null
}

/** Cambios a los datos de un cliente: solo se tocan los campos definidos. */
export interface CustomerPatch {
  /** Nombre nuevo. */
  firstName?: string | undefined
  /** Apellido nuevo. */
  lastName?: string | undefined
  /** Teléfono nuevo, o `null` para borrarlo. */
  phone?: string | null | undefined
}

/** Clientes de la tienda (la tabla `customers`): con cuenta o invitados. */
export interface CustomerRepository {
  /**
   * Busca el cliente de una cuenta.
   *
   * @param userId - Id del usuario.
   */
  findByUserId(userId: string): Promise<Customer | null>

  /**
   * Busca un cliente por email, sin importar mayúsculas (con cuenta o invitado).
   *
   * @param email - Email normalizado.
   */
  findByEmail(email: string): Promise<Customer | null>

  /**
   * Crea un cliente.
   *
   * @param input - Datos del cliente.
   * @returns El cliente creado.
   */
  create(input: NewCustomer): Promise<Customer>

  /**
   * Convierte un invitado en cliente con cuenta: le asigna el usuario y actualiza el nombre.
   *
   * @param customerId - Id del cliente invitado.
   * @param userId - Id del usuario recién creado.
   * @param names - Nombre y apellido con los que se registró.
   * @returns El cliente actualizado (mismo id).
   */
  attachUser(
    customerId: string,
    userId: string,
    names: { firstName: string; lastName: string },
  ): Promise<Customer>

  /**
   * Cambia los datos de un cliente.
   *
   * @param id - Id del cliente.
   * @param patch - Campos a cambiar.
   * @returns El cliente actualizado.
   */
  update(id: string, patch: CustomerPatch): Promise<Customer>
}

/** Token de inyección del {@link CustomerRepository}. */
export const CUSTOMER_REPOSITORY = Symbol('CUSTOMER_REPOSITORY')
