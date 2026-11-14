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
   * Busca el cliente de un email, sin importar mayúsculas: el de la cuenta si la hay; si no, el
   * invitado. Un email puede tener los dos (el registro nunca adopta al invitado).
   *
   * @param email - Email normalizado.
   */
  findByEmail(email: string): Promise<Customer | null>

  /**
   * Busca el invitado (cliente sin cuenta) de un email, sin importar mayúsculas: hay uno como mucho.
   *
   * @param email - Email normalizado.
   */
  findGuestByEmail(email: string): Promise<Customer | null>

  /**
   * Crea un cliente.
   *
   * @param input - Datos del cliente.
   * @returns El cliente creado.
   * @throws {Error} La violación de unicidad de la base (`P2002`) si ya hay un invitado con ese
   *   email.
   */
  create(input: NewCustomer): Promise<Customer>

  /**
   * Crea, en una sola operación atómica, el usuario de una cuenta nueva y su cliente: o quedan los
   * dos o no queda ninguno (nunca un usuario sin cliente).
   *
   * @param user - Datos del usuario.
   * @param customer - Datos del cliente; su `userId` es el id de `user`.
   * @returns El cliente creado, ya con su `userId`.
   * @throws {EmailAlreadyRegisteredError} Si el email ya tiene una cuenta (por ejemplo, otro
   *   registro que ganó entre la consulta y el alta). Se traduce desde la unicidad de la base, no
   *   desde una consulta previa. Un invitado con ese email no molesta: queda como estaba.
   */
  createWithUser(user: NewUser, customer: Omit<NewCustomer, 'userId'>): Promise<Customer>

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
