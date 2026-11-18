import { Controller, Get } from '@nestjs/common'
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'

import { ApiProblemResponses } from '../../../shared/infrastructure/http/openapi'
import { PublicRead } from '../../../shared/infrastructure/throttler/public-read'
import { ListCategoriesQuery } from '../application/queries/list-categories.query'
import type { Category } from '../application/read-models'
import { CategoryDto } from './dto/catalog.response.dto'

/**
 * Líneas del catálogo (`GET /categories`).
 *
 * Lectura pública (`@PublicRead()`, NV-18): límite de 300 pedidos por minuto por IP real del
 * cliente, que solo cuenta con `TRUST_PROXY` o `TRUSTED_PROXY_SECRET`; el servidor de la tienda
 * (SSR/ISR y `next build`) no se limita.
 */
@ApiTags('catalog')
@PublicRead()
@Controller('categories')
export class CategoriesController {
  /** @param listCategories - Query de las líneas. */
  constructor(private readonly listCategories: ListCategoriesQuery) {}

  /**
   * Lista todas las líneas por `position`, con la cantidad de productos publicados de cada una.
   *
   * @returns Las líneas con la forma `Category` del contrato.
   */
  @Get()
  @ApiOperation({ operationId: 'listCategories', summary: 'Listar las líneas de producto' })
  @ApiOkResponse({ type: CategoryDto, isArray: true, description: 'Líneas de producto.' })
  @ApiProblemResponses(429, 500)
  list(): Promise<Category[]> {
    return this.listCategories.execute()
  }
}
