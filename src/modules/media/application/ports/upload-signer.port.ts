/** Datos firmados para subir una foto a Cloudinary desde el navegador (`MediaSignature`). */
export interface UploadSignature {
  /** Momento de la firma, en segundos desde 1970. */
  timestamp: number
  /** Firma de `folder` y `timestamp`. */
  signature: string
  /** Clave pública de la cuenta (nunca el secreto). */
  apiKey: string
  /** Nube de Cloudinary. */
  cloudName: string
  /** Carpeta donde se guarda la foto; la subida tiene que mandar la misma. */
  folder: string
}

/** Firma subidas: la de Cloudinary (con el secreto de la cuenta) o la simulada del mock. */
export interface UploadSigner {
  /**
   * Firma una subida a una carpeta.
   *
   * @param folder - Carpeta de Cloudinary (`galpon/productos`…).
   * @param timestamp - Segundos desde 1970 (entero desde 0).
   * @returns Los cinco datos que manda la subida además del archivo.
   */
  sign(folder: string, timestamp: number): UploadSignature
}

/** Token de inyección del {@link UploadSigner}. */
export const UPLOAD_SIGNER = Symbol('UPLOAD_SIGNER')
