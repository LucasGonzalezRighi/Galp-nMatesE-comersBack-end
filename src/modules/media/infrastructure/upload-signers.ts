import { createHash, randomBytes } from 'node:crypto'

import type { Env } from '../../../config/env'
import { MEDIA_CLOUDINARY_MISSING_MESSAGE } from '../../../config/media'
import { SIMULATED_CLOUD_NAME } from '../domain/media'
import type { UploadSignature, UploadSigner } from '../application/ports/upload-signer.port'

/** Clave pública que firma el modo simulado (la del mock del front). */
export const SIMULATED_API_KEY = 'mock-api-key'

/** Credenciales de la cuenta de Cloudinary. */
export interface CloudinaryCredentials {
  /** `CLOUDINARY_CLOUD_NAME`. */
  cloudName: string
  /** `CLOUDINARY_API_KEY` (pública). */
  apiKey: string
  /** `CLOUDINARY_API_SECRET` (nunca sale del back). */
  apiSecret: string
}

/** Revisa que la hora de una firma sea un entero desde 0 y la carpeta no esté vacía. */
function assertSignable(folder: string, timestamp: number): void {
  if (folder.trim() === '') throw new TypeError('Falta la carpeta de la subida.')
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
    throw new RangeError(
      `La hora de la firma tiene que ser un entero desde 0; se recibió ${String(timestamp)}.`,
    )
  }
}

/**
 * Firma de Cloudinary para una subida desde el navegador: `sha1` en hexadecimal de los
 * parámetros ordenados por nombre (`clave=valor` unidos con `&`) con el secreto pegado al final.
 * No van `file`, `api_key` ni `cloud_name`.
 *
 * @param params - Parámetros firmados (`folder`, `timestamp`).
 * @param apiSecret - Secreto de la cuenta.
 * @returns 40 caracteres hexadecimales.
 * @throws {TypeError} En español, si el secreto está vacío.
 * @throws {RangeError} En español, si no hay parámetros.
 * @example
 * cloudinarySignature({ folder: 'galpon/productos', timestamp: 1700000000 }, secreto)
 * // sha1('folder=galpon/productos&timestamp=1700000000' + secreto)
 */
export function cloudinarySignature(
  params: Readonly<Record<string, string | number>>,
  apiSecret: string,
): string {
  if (apiSecret.trim() === '') throw new TypeError('Falta el secreto de Cloudinary.')
  const names = Object.keys(params).sort()
  if (names.length === 0) throw new RangeError('La firma necesita al menos un parámetro.')
  const toSign = names.map((name) => `${name}=${String(params[name])}`).join('&')
  return createHash('sha1')
    .update(toSign + apiSecret)
    .digest('hex')
}

/** Firmante con la cuenta de Cloudinary (`MEDIA_MODE=cloudinary`). */
export class CloudinaryUploadSigner implements UploadSigner {
  private readonly credentials: CloudinaryCredentials

  /**
   * @param credentials - Nube, clave pública y secreto.
   * @throws {TypeError} En español, si falta alguna.
   */
  constructor(credentials: CloudinaryCredentials) {
    const { cloudName, apiKey, apiSecret } = credentials
    if ([cloudName, apiKey, apiSecret].some((value) => value.trim() === '')) {
      throw new TypeError(MEDIA_CLOUDINARY_MISSING_MESSAGE)
    }
    this.credentials = { cloudName, apiKey, apiSecret }
  }

  /** {@inheritDoc UploadSigner.sign} */
  sign(folder: string, timestamp: number): UploadSignature {
    assertSignable(folder, timestamp)
    const { cloudName, apiKey, apiSecret } = this.credentials
    return {
      timestamp,
      signature: cloudinarySignature({ folder, timestamp }, apiSecret),
      apiKey,
      cloudName,
      folder,
    }
  }
}

/**
 * Firmante simulado (`MEDIA_MODE=simulated`), igual al mock del front: `mock-` y 40 hexadecimales
 * al azar, `mock-api-key` y la nube `galpon-mock`. Cloudinary rechaza esa firma: sirve para el
 * dashboard en modo de prueba y para desarrollar sin cuenta.
 */
export class SimulatedUploadSigner implements UploadSigner {
  /** {@inheritDoc UploadSigner.sign} */
  sign(folder: string, timestamp: number): UploadSignature {
    assertSignable(folder, timestamp)
    return {
      timestamp,
      signature: `mock-${randomBytes(20).toString('hex')}`,
      apiKey: SIMULATED_API_KEY,
      cloudName: SIMULATED_CLOUD_NAME,
      folder,
    }
  }
}

/**
 * Elige el firmante según `MEDIA_MODE` (Ruling B-74).
 *
 * @param env - Modo y credenciales de Cloudinary.
 * @returns {@link CloudinaryUploadSigner} con `cloudinary`; {@link SimulatedUploadSigner} si no.
 * @throws {Error} En español, si el modo es `cloudinary` y falta alguna credencial (`parseEnv`
 *   ya lo impide; esto cubre una configuración armada a mano).
 */
export function createUploadSigner(
  env: Pick<
    Env,
    'MEDIA_MODE' | 'CLOUDINARY_CLOUD_NAME' | 'CLOUDINARY_API_KEY' | 'CLOUDINARY_API_SECRET'
  >,
): UploadSigner {
  if (env.MEDIA_MODE !== 'cloudinary') return new SimulatedUploadSigner()
  const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = env
  if (
    CLOUDINARY_CLOUD_NAME === undefined ||
    CLOUDINARY_API_KEY === undefined ||
    CLOUDINARY_API_SECRET === undefined
  ) {
    throw new Error(MEDIA_CLOUDINARY_MISSING_MESSAGE)
  }
  return new CloudinaryUploadSigner({
    cloudName: CLOUDINARY_CLOUD_NAME,
    apiKey: CLOUDINARY_API_KEY,
    apiSecret: CLOUDINARY_API_SECRET,
  })
}
