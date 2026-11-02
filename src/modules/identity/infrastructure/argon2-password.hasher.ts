import { argon2id, hash, verify } from 'argon2'

import type { PasswordHasher } from '../application/ports/password-hasher.port'

/**
 * Parámetros de argon2id (Ruling B-6: 19 MiB, 2 pasadas, 1 hilo). Son los mismos que usa el seed
 * del admin (`prisma/seed.ts`): el hash los guarda, así que un cambio acá no invalida los viejos.
 */
export const ARGON2_OPTIONS = {
  type: argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const

/** {@link PasswordHasher} con argon2id: cada hash lleva su sal y sus parámetros. */
export class Argon2PasswordHasher implements PasswordHasher {
  /**
   * {@inheritDoc PasswordHasher.hash}
   *
   * @throws {TypeError} En español, si la contraseña está vacía.
   */
  async hash(plain: string): Promise<string> {
    if (plain === '') throw new TypeError('La contraseña no puede estar vacía')
    return hash(plain, ARGON2_OPTIONS)
  }

  /** {@inheritDoc PasswordHasher.verify} */
  async verify(passwordHash: string, plain: string): Promise<boolean> {
    if (passwordHash === '') return false
    try {
      return await verify(passwordHash, plain)
    } catch {
      return false
    }
  }
}
