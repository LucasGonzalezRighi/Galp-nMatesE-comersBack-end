import { isValidRating } from './rating'
import type { ProductReview } from './review.entity'

/** Estados de moderación de una reseña (`ReviewStatus` del contrato). */
export const REVIEW_STATUSES = ['pending', 'approved', 'hidden'] as const

/** `pending` espera la moderación, `approved` se muestra y cuenta y `hidden` quedó oculta. */
export type ReviewStatus = (typeof REVIEW_STATUSES)[number]

/** Nombre con el que firma una reseña cuando la persona no puso el suyo (como el front). */
export const ANONYMOUS_AUTHOR = 'Anónimo'

/** `reason` del aviso `storefront.stale` de una moderación (Ruling B-73). */
export const REVIEW_MODERATED_REASON = 'review.moderated'

/** Largo máximo del nombre con el que firma (`ReviewInput.authorName`). */
export const AUTHOR_NAME_MAX_LENGTH = 40

/** Reseña en cualquier estado, como la ve el dashboard, con su producto. */
export interface ModeratedReview extends ProductReview {
  /** Estado de moderación. */
  status: ReviewStatus
  /** Si es destacada (se muestra en el inicio mientras esté aprobada). */
  featured: boolean
  /** Cuándo cambió de estado por última vez, o `null` si nunca se moderó. */
  moderatedAt: Date | null
  /** Slug actual y nombre del producto (en cualquier estado). */
  product: { slug: string; name: string }
}

/** Cambio que pide el dashboard: solo los campos que vienen. */
export interface ReviewUpdate {
  /** Estado nuevo. */
  status?: ReviewStatus | undefined
  /** Destacada o no. */
  featured?: boolean | undefined
}

/** Lo que se escribe en la reseña: el cambio más la fecha de moderación si cambió el estado. */
export interface ReviewPatch {
  /** Estado nuevo. */
  status?: ReviewStatus
  /** Destacada o no. */
  featured?: boolean
  /** Fecha de moderación (solo si cambia el estado). */
  moderatedAt?: Date
}

/** Reseña nueva de un visitante, antes de guardarla. */
export interface NewReview {
  /** Id del producto reseñado (publicado). */
  productId: string
  /** Nombre con el que firma ("Anónimo" si no puso uno). */
  authorName: string
  /** Puntuación de 1 a 5, múltiplo de 0,5. */
  rating: number
  /** Texto, recortado. */
  text: string
}

/**
 * Nombre con el que firma: el que puso, recortado, o "Anónimo" si llegó `null`, vacío o solo con
 * espacios.
 *
 * @param name - Nombre que mandó la persona.
 * @returns El nombre de la firma.
 */
export function authorNameOrAnonymous(name: string | null): string {
  const trimmed = name?.trim() ?? ''
  return trimmed === '' ? ANONYMOUS_AUTHOR : trimmed
}

/**
 * Revisa una reseña nueva: queda `pending`, sin compra verificada (el visitante no demostró haber
 * comprado) y sin destacar; eso lo pone el repositorio.
 *
 * @param review - Reseña a guardar.
 * @returns La misma reseña, ya revisada.
 * @throws {RangeError} En español, si la puntuación no es un múltiplo de 0,5 de 1 a 5.
 * @throws {TypeError} En español, si falta el producto, el nombre o el texto, o si el nombre pasa
 *   de 40 caracteres.
 */
export function createNewReview(review: NewReview): NewReview {
  if (review.productId.trim() === '' || review.text.trim() === '') {
    throw new TypeError('Una reseña nueva necesita su producto y su texto.')
  }
  if (review.authorName.trim() === '' || review.authorName.length > AUTHOR_NAME_MAX_LENGTH) {
    throw new TypeError('El nombre de una reseña tiene que tener de 1 a 40 caracteres.')
  }
  if (!isValidRating(review.rating)) {
    throw new RangeError(
      `La puntuación tiene que ser un múltiplo de 0,5 de 1 a 5; se recibió ${String(review.rating)}.`,
    )
  }
  return review
}

/**
 * Arma lo que se escribe al moderar: solo lo que vino, y `moderatedAt` solo si el estado cambia
 * (destacar no es moderar). Cualquier combinación vale: se puede destacar una oculta.
 *
 * @param current - Estado actual de la reseña.
 * @param update - Cambio pedido.
 * @param now - Fecha de la moderación.
 * @returns Los campos a escribir.
 * @throws {TypeError} En español, si el cambio no trae ni `status` ni `featured`.
 */
export function moderationPatch(
  current: Pick<ModeratedReview, 'status'>,
  update: ReviewUpdate,
  now: Date,
): ReviewPatch {
  if (update.status === undefined && update.featured === undefined) {
    throw new TypeError('Mandá al menos un cambio: el estado o si es destacada.')
  }
  return {
    ...(update.status === undefined ? {} : { status: update.status }),
    ...(update.featured === undefined ? {} : { featured: update.featured }),
    ...(update.status !== undefined && update.status !== current.status
      ? { moderatedAt: now }
      : {}),
  }
}

/**
 * Etiquetas de la tienda que cambian con una moderación (Ruling B-73): las destacadas del inicio,
 * las reseñas y la ficha del producto, y los listados (traen el promedio).
 *
 * @param slug - Slug actual del producto de la reseña.
 * @returns `reviews:featured`, `reviews:{slug}`, `product:{slug}` y `products`, en ese orden.
 * @throws {TypeError} En español, si el slug está vacío.
 */
export function reviewStorefrontTags(slug: string): string[] {
  if (slug.trim() === '') throw new TypeError('Las etiquetas de una reseña necesitan el slug.')
  return ['reviews:featured', `reviews:${slug}`, `product:${slug}`, 'products']
}
