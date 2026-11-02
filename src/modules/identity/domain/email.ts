/**
 * Normaliza un email como el front: sin espacios alrededor y en minúsculas (la base además lo
 * compara con `citext`).
 *
 * @param raw - Email tal como llegó.
 * @returns El email normalizado.
 * @throws {TypeError} En español, si queda vacío.
 */
export function normalizeEmail(raw: string): string {
  const email = raw.trim().toLowerCase()
  if (email === '') {
    throw new TypeError('El email no puede estar vacío')
  }
  return email
}
