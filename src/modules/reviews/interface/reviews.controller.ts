import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common'
import {
  ApiAcceptedResponse,
  ApiExtraModels,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  PickType,
} from '@nestjs/swagger'

import { type ClientIpRequest, knownClientIp } from '../../../shared/infrastructure/http/client-ip'
import { ApiProblemResponses, schemaRef } from '../../../shared/infrastructure/http/openapi'
import { PageQueryDto } from '../../../shared/infrastructure/http/page.dto'
import { PublicRead } from '../../../shared/infrastructure/throttler/public-read'
import {
  PRODUCT_NOT_FOUND,
  ProductSlugParamDto,
} from '../../catalog/interface/dto/product-slug.param.dto'
import { SubmitReviewCommand } from '../application/commands/submit-review.command'
import { ListFeaturedReviewsQuery } from '../application/queries/list-featured-reviews.query'
import { ListProductReviewsQuery } from '../application/queries/list-product-reviews.query'
import type { FeaturedReview, ReviewPage, ReviewReceipt } from '../application/read-models'
import { ReviewInputDto } from './dto/review-input.dto'
import { ReviewDto, ReviewPageDto, ReviewReceiptDto } from './dto/reviews.response.dto'

/** Query de las reseñas de un producto: solo `page` (el tamaño de página lo fija el back). */
export class ReviewsPageQueryDto extends PickType(PageQueryDto, ['page'] as const) {}

/**
 * Reseñas públicas: las de un producto, las destacadas del inicio y el envío de una reseña nueva
 * (`POST /products/{slug}/reviews`), que queda pendiente de moderación.
 *
 * Las lecturas son públicas (`@PublicRead()`, NV-18): límite de 300 pedidos por minuto por IP
 * real del cliente, que solo cuenta con `TRUST_PROXY`; el servidor de la tienda no se limita. El
 * `POST` es un formulario público con el límite global por IP y un tope diario de reseñas
 * pendientes por IP real (NV-21).
 */
@ApiTags('reviews')
@ApiExtraModels(ReviewDto, ReviewReceiptDto)
@Controller()
export class ReviewsController {
  /**
   * @param listProductReviews - Query de las reseñas de un producto.
   * @param listFeaturedReviews - Query de las destacadas.
   * @param submitReview - Envío de una reseña nueva.
   */
  constructor(
    private readonly listProductReviews: ListProductReviewsQuery,
    private readonly listFeaturedReviews: ListFeaturedReviewsQuery,
    private readonly submitReview: SubmitReviewCommand,
  ) {}

  /**
   * Recibe la reseña de un producto publicado: queda pendiente hasta que el admin la apruebe. El
   * pipe valida antes; después, un slug que no existe da 404 aunque el campo trampa venga lleno
   * (orden del mock), y con el campo trampa lleno responde igual sin guardar nada. No avisa a la
   * tienda: una pendiente no se ve. Con la IP real del cliente conocida, cuenta en su cupo diario
   * (NV-21).
   *
   * @param params - Slug de la ruta ya validado (actual o anterior).
   * @param body - Reseña ya validada.
   * @param req - Pedido de Express, para la IP real del cliente.
   * @returns `{ status: 'pending' }` (202).
   * @throws {NotFoundException} Si no hay un producto publicado con ese slug (404).
   * @throws {TooManyReviewsError} 429 si la IP ya agotó el cupo del día.
   */
  @Post('products/:slug/reviews')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ operationId: 'createReview', summary: 'Enviar una reseña' })
  @ApiAcceptedResponse({
    type: ReviewReceiptDto,
    description: 'Reseña recibida; queda pendiente de aprobación.',
  })
  @ApiProblemResponses(404, 422, 429, 500)
  async create(
    @Param() params: ProductSlugParamDto,
    @Body() body: ReviewInputDto,
    @Req() req: ClientIpRequest,
  ): Promise<ReviewReceipt> {
    const receipt = await this.submitReview.execute(params.slug, body.toInput(), knownClientIp(req))
    if (receipt === null) throw new NotFoundException(PRODUCT_NOT_FOUND)
    return receipt
  }

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
  @PublicRead()
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
  @PublicRead()
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
