import { Controller, Get, NotFoundException, Param, Query } from '@nestjs/common'
import { ApiExtraModels, ApiOkResponse, ApiOperation, ApiTags, PickType } from '@nestjs/swagger'
import { SkipThrottle } from '@nestjs/throttler'

import { ApiProblemResponses, schemaRef } from '../../../shared/infrastructure/http/openapi'
import { PageQueryDto } from '../../../shared/infrastructure/http/page.dto'
import {
  PRODUCT_NOT_FOUND,
  ProductSlugParamDto,
} from '../../catalog/interface/dto/product-slug.param.dto'
import { ListFeaturedReviewsQuery } from '../application/queries/list-featured-reviews.query'
import { ListProductReviewsQuery } from '../application/queries/list-product-reviews.query'
import type { FeaturedReview, ReviewPage } from '../application/read-models'
import { ReviewDto, ReviewPageDto } from './dto/reviews.response.dto'

/** Query de las reseñas de un producto: solo `page` (el tamaño de página lo fija el back). */
export class ReviewsPageQueryDto extends PickType(PageQueryDto, ['page'] as const) {}

/**
 * Lecturas públicas de reseñas: las de un producto y las destacadas del inicio. Enviar una
 * reseña (`POST /products/{slug}/reviews`) llega en B7.
 *
 * Sin límite de pedidos por IP: la tienda lee desde un solo servidor (SSR/ISR y `next build`) y
 * el spec §3.2 solo limita login, formularios públicos y creación de pedidos. El `POST` de B7 es
 * un formulario público: tiene que reponer el límite en su método con `@SkipThrottle({ default: false })`.
 */
@ApiTags('reviews')
@ApiExtraModels(ReviewDto)
@SkipThrottle()
@Controller()
export class ReviewsController {
  /**
   * @param listProductReviews - Query de las reseñas de un producto.
   * @param listFeaturedReviews - Query de las destacadas.
   */
  constructor(
    private readonly listProductReviews: ListProductReviewsQuery,
    private readonly listFeaturedReviews: ListFeaturedReviewsQuery,
  ) {}

  /**
   * Devuelve las reseñas aprobadas de un producto, de la más nueva a la más vieja, con el
   * promedio y la distribución de todas las aprobadas.
   *
   * @param params - Slug de la ruta ya validado (actual o anterior).
   * @param query - Página ya validada.
   * @returns La página con la forma `ReviewPage` del contrato.
   * @throws {NotFoundException} Si no hay un producto publicado con ese slug (404).
   */
  @Get('products/:slug/reviews')
  @ApiOperation({ operationId: 'listProductReviews', summary: 'Listar las reseñas de un producto' })
  @ApiOkResponse({ type: ReviewPageDto, description: 'Página de reseñas con sus estadísticas.' })
  @ApiProblemResponses(404, 422, 429, 500)
  async listForProduct(
    @Param() params: ProductSlugParamDto,
    @Query() query: ReviewsPageQueryDto,
  ): Promise<ReviewPage> {
    const page = await this.listProductReviews.execute(params.slug, query.page)
    if (page === null) throw new NotFoundException(PRODUCT_NOT_FOUND)
    return page
  }

  /**
   * Devuelve las reseñas aprobadas y destacadas, con el producto de cada una.
   *
   * @returns Las destacadas, de la más nueva a la más vieja.
   */
  @Get('reviews/featured')
  @ApiOperation({ operationId: 'listFeaturedReviews', summary: 'Listar las reseñas destacadas' })
  @ApiOkResponse({
    description: 'Reseñas destacadas.',
    schema: { type: 'array', items: schemaRef('FeaturedReview') },
  })
  @ApiProblemResponses(429, 500)
  listFeatured(): Promise<FeaturedReview[]> {
    return this.listFeaturedReviews.execute()
  }
}
