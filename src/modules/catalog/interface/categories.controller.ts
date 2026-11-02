import { Controller, Get } from '@nestjs/common'
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import { SkipThrottle } from '@nestjs/throttler'

import { ApiProblemResponses } from '../../../shared/infrastructure/http/openapi'
import { ListCategoriesQuery } from '../application/queries/list-categories.query'
import type { Category } from '../application/read-models'
import { CategoryDto } from './dto/catalog.response.dto'

/**
 * Líneas del catálogo (`GET /categories`).
 *
 * Sin límite de pedidos por IP: la tienda lee desde un solo servidor (SSR/ISR y `next build`) y
 * el spec §3.2 solo limita login, formularios públicos y creación de pedidos.
 */
@ApiTags('catalog')
@SkipThrottle()
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
