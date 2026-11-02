/** Foto de un producto o de una línea (forma `Image` del contrato). */
export interface ProductImage {
  /** Identificador estable de la foto en el proveedor. */
  publicId: string
  /** URL que sirve la tienda. */
  url: string
  /** Ancho en píxeles (entero desde 1). */
  width: number
  /** Alto en píxeles (entero desde 1). */
  height: number
  /** Texto alternativo. */
  alt: string
}

/**
 * Crea una foto validada.
 *
 * @param props - Datos de la foto.
 * @returns Una copia de la foto, ya validada.
 * @throws {TypeError} En español, si falta el `publicId` o la URL.
 * @throws {RangeError} En español, si el ancho o el alto no son enteros desde 1.
 */
export function createProductImage(props: ProductImage): ProductImage {
  if (props.publicId.trim() === '' || props.url.trim() === '') {
    throw new TypeError('Una foto necesita su publicId y su URL.')
  }
  for (const side of [props.width, props.height]) {
    if (!Number.isInteger(side) || side < 1) {
      throw new RangeError(
        `Las medidas de la foto ${props.publicId} tienen que ser enteros desde 1; se recibió ${String(side)}.`,
      )
    }
  }
  return {
    publicId: props.publicId,
    url: props.url,
    width: props.width,
    height: props.height,
    alt: props.alt,
  }
}
