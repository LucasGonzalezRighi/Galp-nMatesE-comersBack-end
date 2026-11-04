import { SIMULATED_CLOUD_NAME } from '../modules/media/domain/media'
import type { Env } from './env.schema'

/** Mensaje de `parseEnv` cuando `MEDIA_MODE=cloudinary` y falta alguna credencial. */
export const MEDIA_CLOUDINARY_MISSING_MESSAGE =
  'Con MEDIA_MODE=cloudinary hacen falta CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY y CLOUDINARY_API_SECRET.'

/** Mensaje de `parseEnv` cuando `NODE_ENV=production` y `MEDIA_MODE` no es `cloudinary`. */
export const MEDIA_PRODUCTION_SIMULATED_MESSAGE =
  'En producción MEDIA_MODE tiene que ser cloudinary.'

/**
 * Nube de Cloudinary con la que se arman las `url` de las fotos (Ruling B-74).
 *
 * @param env - Modo de las fotos y la nube configurada.
 * @returns `CLOUDINARY_CLOUD_NAME` con `cloudinary`; `galpon-mock` (la del mock) en `simulated`.
 * @throws {Error} En español, si el modo es `cloudinary` y falta la nube (`parseEnv` ya lo
 *   impide; esto cubre una configuración armada a mano).
 */
export function mediaCloudName(env: Pick<Env, 'MEDIA_MODE' | 'CLOUDINARY_CLOUD_NAME'>): string {
  if (env.MEDIA_MODE !== 'cloudinary') return SIMULATED_CLOUD_NAME
  if (env.CLOUDINARY_CLOUD_NAME === undefined || env.CLOUDINARY_CLOUD_NAME.trim() === '') {
    throw new Error(MEDIA_CLOUDINARY_MISSING_MESSAGE)
  }
  return env.CLOUDINARY_CLOUD_NAME
}
