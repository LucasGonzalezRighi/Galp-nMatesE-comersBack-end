import type { Customer } from '../../domain/customer.entity'
import type { NewUser } from './user.repository.port'

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
   * Crea, en una sola operación atómica, el usuario de una cuenta nueva y su cliente: o quedan los
   * dos o no queda ninguno (nunca un usuario sin cliente).
   *
   * @param user - Datos del usuario.
   * @param customer - Datos del cliente; su `userId` es el id de `user`.
   * @returns El cliente creado, ya con su `userId`.
   * @throws {EmailAlreadyRegisteredError} Si el email ya está tomado por un usuario o por otro
   *   cliente (por ejemplo, un invitado que apareció entre la consulta y el alta). Se traduce
   *   desde la unicidad de la base, no desde una consulta previa.
   */
  createWithUser(user: NewUser, customer: Omit<NewCustomer, 'userId'>): Promise<Customer>

  /**
   * Convierte un invitado en cliente con cuenta, en una sola operación atómica: crea el usuario,
   * se lo asigna al cliente y actualiza el nombre. Si algo falla, no queda ningún usuario.
   *
   * @param customerId - Id del cliente invitado.
   * @param user - Datos del usuario nuevo.
   * @param names - Nombre y apellido con los que se registró.
   * @returns El cliente actualizado (mismo id).
   * @throws {EmailAlreadyRegisteredError} Si el email ya tiene un usuario o si el cliente dejó de
   *   ser un invitado (otro registro lo ganó).
   */
  attachUser(
    customerId: string,
    user: NewUser,
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
