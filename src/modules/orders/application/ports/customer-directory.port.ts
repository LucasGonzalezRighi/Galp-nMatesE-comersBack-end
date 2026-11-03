import type { OrderContact } from '../../domain/order.entity'

/** Cliente encontrado por email: lo justo para decidir el dueño del pedido. */
export interface DirectoryCustomer {
  /** Id del cliente. */
  id: string
  /** Usuario de la cuenta, o `null` si es un invitado. */
  userId: string | null
}

/** Lo que `orders` necesita de los clientes para vincular un pedido de invitado. */
export interface CustomerDirectoryPort {
  /**
   * @param email - Email en minúsculas.
   * @returns El cliente con ese email (invitado o con cuenta), o `null`.
   */
  findByEmail(email: string): Promise<DirectoryCustomer | null>

  /**
   * Crea un cliente invitado (`user_id null`) con los datos del checkout. Si otro pedido lo creó
   * al mismo tiempo, devuelve ese cliente en lugar de fallar.
   *
   * @param input - Email, nombre, apellido y teléfono.
   * @returns El id del cliente.
   */
  createGuest(input: OrderContact): Promise<{ id: string }>

  /**
   * Actualiza nombre, apellido y teléfono de un invitado con lo que escribió en el checkout.
   *
   * @param id - Id del cliente invitado.
   * @param input - Nombre, apellido y teléfono.
   */
  updateGuest(id: string, input: Omit<OrderContact, 'email'>): Promise<void>
}

/** Token de inyección del {@link CustomerDirectoryPort}. */
export const CUSTOMER_DIRECTORY_PORT = Symbol('CUSTOMER_DIRECTORY_PORT')
