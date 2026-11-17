/** Cuenta que se elimina: el usuario de la sesión y su cliente. */
export interface AccountToDelete {
  /** Id del usuario (`users.id`). */
  userId: string
  /** Id del cliente de esa cuenta (`customers.id`). */
  customerId: string
}

/**
 * Baja de una cuenta de cliente (`DELETE /me`, LS-5), en una sola transacción: borra el usuario
 * (y con él sus tokens de contraseña), el cliente y sus direcciones y las reseñas pendientes; los
 * pedidos y las reseñas ya moderadas quedan sin vínculo a la cuenta. La decisión por tabla está en
 * `docs/adr/0008-datos-personales.md`. Nunca vuelve a vincular nada.
 */
export interface AccountDeletionRepository {
  /**
   * Elimina la cuenta.
   *
   * @param account - Usuario y cliente de la cuenta.
   * @throws {TypeError} En español, si falta alguno de los dos ids.
   */
  deleteAccount(account: AccountToDelete): Promise<void>
}

/** Token de inyección del {@link AccountDeletionRepository}. */
export const ACCOUNT_DELETION_REPOSITORY = Symbol('ACCOUNT_DELETION_REPOSITORY')
