import { createHash, randomBytes } from 'node:crypto'

import type { SecretsPort } from '../../application/ports/secrets.port'

/** Máximo de bytes por token: alcanza de sobra y corta un pedido absurdo. */
const MAX_TOKEN_BYTES = 1024

/** {@link SecretsPort} con `node:crypto`: `randomBytes` (CSPRNG) y SHA-256. */
export class CryptoSecrets implements SecretsPort {
  /**
   * {@inheritDoc SecretsPort.token}
   *
   * @throws {RangeError} En español, si `bytes` no es un entero entre 1 y 1024.
   */
  token(bytes: number): string {
    if (!Number.isInteger(bytes) || bytes < 1 || bytes > MAX_TOKEN_BYTES) {
      throw new RangeError(
        `La cantidad de bytes de un token tiene que ser un entero entre 1 y ${String(MAX_TOKEN_BYTES)} (llegó ${String(bytes)})`,
      )
    }
    return randomBytes(bytes).toString('hex')
  }

  /** {@inheritDoc SecretsPort.sha256} */
  sha256(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex')
  }
}
