/** Cliente de la tienda: con cuenta (`userId`) o invitado que compró sin registrarse. */
export interface Customer {
  /** Id del cliente (UUID v7). */
  id: string
  /** Usuario de su cuenta, o `null` si es un invitado. */
  userId: string | null
  /** Email normalizado; único. */
  email: string
  /** Nombre. */
  firstName: string
  /** Apellido. */
  lastName: string
  /** Teléfono de 10 dígitos (ya normalizado por la tienda), o `null`. */
  phone: string | null
}

/**
 * Normaliza un nombre o apellido: sin espacios alrededor (el formato lo valida la interfaz).
 *
 * @param raw - Nombre tal como llegó.
 * @returns El nombre recortado.
 * @throws {TypeError} En español, si queda vacío.
 */
export function normalizePersonName(raw: string): string {
  const name = raw.trim()
  if (name === '') {
    throw new TypeError('El nombre no puede estar vacío')
  }
  return name
}
