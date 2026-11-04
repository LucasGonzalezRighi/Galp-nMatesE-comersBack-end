/** Proveedor de las fotos que guarda el dashboard (`MEDIA_MODE`). */
export type MediaProvider = 'simulated' | 'cloudinary'

/**
 * Dónde viven las fotos nuevas que guarda el dashboard: el proveedor que se anota en
 * `media_assets.provider` y la nube con la que se arma su `url` (Ruling B-74).
 */
export interface MediaStorage {
  /** `cloudinary` o `simulated`, según `MEDIA_MODE`. */
  provider: MediaProvider
  /** `CLOUDINARY_CLOUD_NAME`, o `galpon-mock` en simulado. */
  cloudName: string
}

/** Token de inyección de la {@link MediaStorage} (lo exporta `MediaModule`). */
export const MEDIA_STORAGE = Symbol('MEDIA_STORAGE')
