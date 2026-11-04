import type { FieldError } from '../../../shared/domain/change-notice'

/** Para qué es una foto: define su carpeta de Cloudinary (`MEDIA_PURPOSES` del front). */
export const MEDIA_PURPOSES = ['product', 'category', 'partner', 'site'] as const

/** Uso de una foto. */
export type MediaPurpose = (typeof MEDIA_PURPOSES)[number]

/** Carpeta de Cloudinary de cada uso (`MEDIA_FOLDERS` del front); la subida la manda en `folder`. */
export const MEDIA_FOLDERS = {
  product: 'galpon/productos',
  category: 'galpon/lineas',
  partner: 'galpon/socios',
  site: 'galpon/sitio',
} as const satisfies Record<MediaPurpose, string>

/** Nube de Cloudinary del modo simulado: la misma `cloudName` que firma el mock del front. */
export const SIMULATED_CLOUD_NAME = 'galpon-mock'

/** Mensaje del 422 `unknown_image` (el mismo del mock y del contrato). */
export const UNKNOWN_IMAGE_MESSAGE = 'La foto no existe: subila de nuevo'

/** Código del error de una foto que el back no conoce. */
const UNKNOWN_IMAGE_CODE = 'unknown_image'

/** Foto guardada (`Image` del contrato): la `url` la arma el back, el resto viene del cuerpo. */
export interface MediaImage {
  /** Identificador de la foto en Cloudinary. */
  publicId: string
  /** URL que sirve la tienda. */
  url: string
  /** Ancho en píxeles. */
  width: number
  /** Alto en píxeles. */
  height: number
  /** Texto alternativo (por uso). */
  alt: string
}

/** Cómo resolver una foto que llega del dashboard. */
export interface ImageRule {
  /** Uso de la foto: su `publicId` tiene que estar en la carpeta de este uso. */
  purpose: MediaPurpose
  /** Fotos que el recurso ya tiene: si es una de ellas, conserva su `url`. */
  stored: readonly MediaImage[]
  /** Nube de Cloudinary con la que se arma la `url` de una foto nueva. */
  cloudName: string
  /** Ruta de la foto en el cuerpo (`images.2`, `image`, `partners.0.photo`). */
  field: string
}

/** Resultado de {@link resolveImage}. */
export type ResolvedImage = { ok: true; image: MediaImage } | { ok: false; error: FieldError }

/**
 * Indica si un texto es un uso de foto.
 *
 * @param value - Texto a revisar.
 * @returns `true` si es un {@link MediaPurpose}.
 */
export function isMediaPurpose(value: string): value is MediaPurpose {
  return (MEDIA_PURPOSES as readonly string[]).includes(value)
}

/**
 * Arma la URL pública de una foto de Cloudinary.
 *
 * @param cloudName - Nube de Cloudinary (`CLOUDINARY_CLOUD_NAME`, o `galpon-mock` en simulado).
 * @param publicId - Identificador de la foto.
 * @returns `https://res.cloudinary.com/{cloudName}/image/upload/{publicId}`.
 * @throws {TypeError} En español, si la nube o el `publicId` están vacíos.
 */
export function mediaUrl(cloudName: string, publicId: string): string {
  if (cloudName.trim() === '') throw new TypeError('Falta la nube de Cloudinary de la foto.')
  if (publicId.trim() === '') throw new TypeError('Falta el publicId de la foto.')
  return `https://res.cloudinary.com/${cloudName}/image/upload/${publicId}`
}

/**
 * Indica si lo que sigue a la carpeta de un uso queda adentro de ella: uno o más segmentos
 * separados por una barra, ninguno vacío (sin barras dobles ni al final), ni `.` ni `..`, y sin
 * barras invertidas. Así `galpon/socios/../productos/x` no pasa por una foto de socios.
 *
 * @param rest - El `publicId` sin la carpeta y su barra.
 * @returns `true` si es una ruta limpia dentro de la carpeta.
 */
function isInsideFolder(rest: string): boolean {
  if (rest === '' || rest.includes('\\')) return false
  return rest.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..')
}

/**
 * Resuelve una foto que manda el dashboard (`ImageInput`) a la que se guarda (`Image`), sin
 * consultar a Cloudinary (Ruling B-74): si es una de las que el recurso ya tiene conserva su
 * `url`; si no, su `publicId` tiene que estar dentro de la carpeta de su uso (sin segmentos `.`
 * o `..`, barras dobles ni barras invertidas) y la `url` se arma con la nube. Medidas y `alt`
 * salen siempre del cuerpo.
 *
 * @param input - Foto del cuerpo, ya validada en su forma.
 * @param rule - Uso, fotos guardadas, nube y ruta del campo.
 * @returns La foto lista para guardar, o el 422 `unknown_image` en `{field}.publicId`.
 * @throws {RangeError} En español, si el uso no es uno de {@link MEDIA_PURPOSES}.
 * @throws {TypeError} En español, si el campo está vacío.
 */
export function resolveImage(input: Omit<MediaImage, 'url'>, rule: ImageRule): ResolvedImage {
  if (!isMediaPurpose(rule.purpose)) {
    throw new RangeError(`"${String(rule.purpose)}" no es un uso de foto.`)
  }
  if (rule.field.trim() === '') throw new TypeError('Falta la ruta del campo de la foto.')
  const { publicId, width, height, alt } = input
  const stored = rule.stored.find((image) => image.publicId === publicId)
  if (stored !== undefined)
    return { ok: true, image: { publicId, url: stored.url, width, height, alt } }
  const folder = `${MEDIA_FOLDERS[rule.purpose]}/`
  if (publicId.startsWith(folder) && isInsideFolder(publicId.slice(folder.length))) {
    return {
      ok: true,
      image: { publicId, url: mediaUrl(rule.cloudName, publicId), width, height, alt },
    }
  }
  return {
    ok: false,
    error: {
      field: `${rule.field}.publicId`,
      code: UNKNOWN_IMAGE_CODE,
      message: UNKNOWN_IMAGE_MESSAGE,
    },
  }
}
