import { Injectable } from '@nestjs/common'

import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service'
import type {
  CategoryListing,
  CategoryRepository,
} from '../application/ports/category.repository.port'
import { CATEGORY_INCLUDE, toCategoryListing } from './category.mapper'

/** Lecturas de las líneas del catálogo con Prisma (Postgres). */
@Injectable()
export class PrismaCategoryRepository implements CategoryRepository {
  /** @param prisma - Cliente de Prisma de la app. */
  constructor(private readonly prisma: PrismaService) {}

  /** {@inheritDoc CategoryRepository.list} */
  async list(): Promise<CategoryListing[]> {
    const rows = await this.prisma.category.findMany({
      orderBy: { position: 'asc' },
      include: CATEGORY_INCLUDE,
    })
    return rows.map(toCategoryListing)
  }
}
