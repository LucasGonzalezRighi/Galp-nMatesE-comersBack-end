import { isValidRating } from './rating'

/** Reseña aprobada de un producto, como la lee el público (sin moderación ni datos del cliente). */
export interface ProductReview {
  /** Id de la reseña. */
  id: string
  /** Id del producto reseñado. */
  productId: string
  /** Nombre con el que firma. */
  authorName: string
  /** Puntuación de 1 a 5, con medias estrellas. */
  rating: number
  /** Texto de la reseña. */
  text: string
  /** Fecha de la reseña. */
  createdAt: Date
  /** Si es de una compra verificada. */
  verifiedPurchase: boolean
}

/**
 * Crea una reseña validada.
 *
 * @param props - Datos de la reseña.
 * @returns La misma reseña, ya validada.
 * @throws {RangeError} En español, si la puntuación no es un múltiplo de 0,5 de 1 a 5 o la fecha
 *   no es válida.
 * @throws {TypeError} En español, si falta el id, el producto o el nombre.
 */
export function createProductReview(props: ProductReview): ProductReview {
  if (props.id.trim() === '' || props.productId.trim() === '') {
    throw new TypeError('Una reseña necesita su id y el id de su producto.')
  }
  if (props.authorName.trim() === '') {
    throw new TypeError('Una reseña necesita el nombre de quien la escribió.')
  }
  if (!isValidRating(props.rating)) {
    throw new RangeError(
      `La puntuación tiene que ser un múltiplo de 0,5 de 1 a 5; se recibió ${String(props.rating)}.`,
    )
  }
  if (Number.isNaN(props.createdAt.getTime())) {
    throw new RangeError('La fecha de la reseña no es válida.')
  }
  return props
}
