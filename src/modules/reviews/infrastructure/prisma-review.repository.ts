import { Injectable } from '@nestjs/common'

import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service'
import { createProductReview, type ProductReview } from '../domain/review.entity'
import type {
  FeaturedProductReview,
  ReviewRepository,
} from '../application/ports/review.repository.port'

/** Columnas de `reviews` que ve el público. */
const REVIEW_SELECT = {
  id: true,
  productId: true,
  authorName: true,
  rating: true,
  text: true,
  createdAt: true,
  verifiedPurchase: true,
} as const

/** De la más nueva a la más vieja; el id (v7, creciente) desempata. */
const NEWEST_FIRST = [{ createdAt: 'desc' }, { id: 'desc' }] as const

/** Fila de `reviews` con las columnas de {@link REVIEW_SELECT}. */
interface ReviewRow {
  id: string
  productId: string
  authorName: string
  rating: { toNumber(): number }
  text: string
  createdAt: Date
  verifiedPurchase: boolean
}

/** Pasa una fila a la reseña del dominio (el `Decimal` de `rating` a `number`). */
function toProductReview(row: ReviewRow): ProductReview {
  return createProductReview({ ...row, rating: row.rating.toNumber() })
}

/** Lecturas de reseñas aprobadas con Prisma (Postgres). */
@Injectable()
export class PrismaReviewRepository implements ReviewRepository {
  /** @param prisma - Cliente de Prisma de la app. */
  constructor(private readonly prisma: PrismaService) {}

  /** {@inheritDoc ReviewRepository.listApprovedByProduct} */
  async listApprovedByProduct(productId: string): Promise<ProductReview[]> {
    const rows = await this.prisma.review.findMany({
      where: { productId, status: 'approved' },
      orderBy: [...NEWEST_FIRST],
      select: REVIEW_SELECT,
    })
    return rows.map(toProductReview)
  }

  /**
   * {@inheritDoc ReviewRepository.listFeatured}
   *
   * El slug y el nombre del producto se leen con la relación de Prisma (lectura de solo lectura
   * sobre `products`, sin pasar por el catálogo).
   */
  async listFeatured(): Promise<FeaturedProductReview[]> {
    const rows = await this.prisma.review.findMany({
      where: { status: 'approved', featured: true, product: { status: 'published' } },
      orderBy: [...NEWEST_FIRST],
      select: { ...REVIEW_SELECT, product: { select: { slug: true, name: true } } },
    })
    return rows.map(({ product, ...review }) => ({
      review: toProductReview(review),
      product: { slug: product.slug, name: product.name },
    }))
  }
}
