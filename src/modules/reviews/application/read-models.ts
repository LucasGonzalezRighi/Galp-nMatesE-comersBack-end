// Formas de lectura de reseñas: copian exactamente `components/schemas` del contrato
// (`../frontend/docs/api/openapi.yaml`).

/** Promedio y cantidad de reseñas aprobadas (`Rating`). */
export interface Rating {
  /** Promedio sin redondear, de 0 a 5. */
  average: number
  /** Cantidad de reseñas aprobadas. */
  count: number
}

/** Reseña pública (`Review`). */
export interface Review {
  /** Id de la reseña. */
  id: string
  /** Nombre con el que firma. */
  authorName: string
  /** Puntuación de 1 a 5, múltiplo de 0,5. */
  rating: number
  /** Texto de la reseña. */
  text: string
  /** Fecha ISO 8601 (`date-time`). */
  createdAt: string
  /** Si es de una compra verificada. */
  verifiedPurchase: boolean
}

/** Fila de la distribución por estrellas. */
export interface ReviewStatsBucket {
  /** Estrellas, de 1 a 5. */
  stars: number
  /** Reseñas de la fila. */
  count: number
  /** Porcentaje del total, de 0 a 100. */
  percent: number
}

/** Estadísticas de todas las reseñas aprobadas de un producto (`ReviewStats`). */
export interface ReviewStats {
  /** Promedio sin redondear (0 sin reseñas). */
  average: number
  /** Cantidad de reseñas aprobadas. */
  count: number
  /** Cinco filas, de 5 a 1 estrellas; una media estrella cuenta en la fila de su parte entera. */
  distribution: ReviewStatsBucket[]
}

/** Página de reseñas de un producto con sus estadísticas (`ReviewPage`). */
export interface ReviewPage {
  /** Reseñas de la página, de la más nueva a la más vieja. */
  items: Review[]
  /** Número de página, desde 1. */
  page: number
  /** Reseñas por página. */
  pageSize: number
  /** Total de reseñas aprobadas. */
  total: number
  /** Estadísticas de todas las aprobadas (no solo de la página). */
  stats: ReviewStats
}

/** Reseña destacada del inicio, con su producto (`FeaturedReview`). */
export interface FeaturedReview extends Review {
  /** Producto reseñado. */
  product: {
    /** Slug actual del producto. */
    slug: string
    /** Nombre del producto. */
    name: string
  }
}
