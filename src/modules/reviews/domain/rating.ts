/** Fila de la distribución de reseñas por estrellas (la de `ReviewStats.distribution`). */
export interface RatingBucket {
  /** Estrellas de la fila, de 1 a 5. */
  stars: number
  /** Reseñas que caen en la fila. */
  count: number
  /** Porcentaje del total, redondeado al entero. */
  percent: number
}

/** Promedio y cantidad de reseñas aprobadas (la forma `Rating` del contrato). */
export interface RatingSummary {
  /** Promedio sin redondear, de 0 a 5 (0 sin reseñas). */
  average: number
  /** Cantidad de reseñas. */
  count: number
}

/** Estrellas de las filas de la distribución, de mayor a menor. */
const STARS_DESCENDING = [5, 4, 3, 2, 1] as const

/**
 * Indica si una puntuación es válida: múltiplo de 0,5 de 1 a 5 (admite medias estrellas).
 *
 * @param rating - Puntuación a revisar.
 * @returns `true` si es válida.
 */
export function isValidRating(rating: number): boolean {
  return Number.isFinite(rating) && rating >= 1 && rating <= 5 && Number.isInteger(rating * 2)
}

/**
 * Revisa una lista de puntuaciones.
 *
 * @throws {RangeError} En español, con la primera puntuación inválida.
 */
function assertValidRatings(ratings: readonly number[]): void {
  for (const rating of ratings) {
    if (!isValidRating(rating)) {
      throw new RangeError(
        `La puntuación tiene que ser un múltiplo de 0,5 de 1 a 5; se recibió ${String(rating)}.`,
      )
    }
  }
}

/**
 * Calcula el promedio simple de las puntuaciones, como el front (`averageRating` de su dominio).
 *
 * @param ratings - Puntuaciones de las reseñas aprobadas; puede estar vacía.
 * @returns El promedio sin redondear, o 0 sin reseñas.
 * @throws {RangeError} En español, si alguna puntuación no es un múltiplo de 0,5 de 1 a 5.
 * @example
 * averageRating([5, 5, 4]) // 4.666…
 */
export function averageRating(ratings: readonly number[]): number {
  assertValidRatings(ratings)
  if (ratings.length === 0) return 0
  return ratings.reduce((total, rating) => total + rating, 0) / ratings.length
}

/**
 * Arma la distribución por estrellas: una media estrella cuenta en la fila de su parte entera
 * (4,5 en la de 4). Los porcentajes se redondean de a uno y pueden no sumar 100.
 *
 * @param ratings - Puntuaciones de las reseñas aprobadas; puede estar vacía.
 * @returns Cinco filas, de 5 a 1 estrellas.
 * @throws {RangeError} En español, si alguna puntuación no es un múltiplo de 0,5 de 1 a 5.
 */
export function ratingDistribution(ratings: readonly number[]): RatingBucket[] {
  assertValidRatings(ratings)
  return STARS_DESCENDING.map((stars) => {
    const count = ratings.filter((rating) => Math.floor(rating) === stars).length
    return {
      stars,
      count,
      percent: ratings.length === 0 ? 0 : Math.round((count / ratings.length) * 100),
    }
  })
}

/**
 * Resume las puntuaciones en promedio y cantidad.
 *
 * @param ratings - Puntuaciones de las reseñas aprobadas; puede estar vacía.
 * @returns El promedio sin redondear y la cantidad.
 * @throws {RangeError} En español, si alguna puntuación no es un múltiplo de 0,5 de 1 a 5.
 */
export function summarizeRatings(ratings: readonly number[]): RatingSummary {
  return { average: averageRating(ratings), count: ratings.length }
}
