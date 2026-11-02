import { Controller, Get, NotFoundException, Param, Query } from '@nestjs/common'
import {
  ApiExtraModels,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger'
import { SkipThrottle } from '@nestjs/throttler'

import {
  ApiProblemResponses,
  ImageDto,
  schemaRef,
} from '../../../shared/infrastructure/http/openapi'
import { GetProductQuery } from '../application/queries/get-product.query'
import {
  GetRelatedProductsQuery,
  RELATED_PRODUCTS_LIMIT,
} from '../application/queries/get-related-products.query'
import { ListProductsQuery } from '../application/queries/list-products.query'
import type { ProductDetail, ProductPage, ProductSummary } from '../application/read-models'
import {
  ProductOptionsDto,
  ProductPageDto,
  ProductSummaryDto,
  ProductTabsDto,
} from './dto/catalog.response.dto'
import { ListProductsQueryDto } from './dto/list-products.query.dto'
import { PRODUCT_NOT_FOUND, ProductSlugParamDto } from './dto/product-slug.param.dto'

/**
 * Catálogo publicado: listado, ficha y relacionados (`/products`).
 *
 * Sin límite de pedidos por IP: la tienda lee desde un solo servidor (SSR/ISR y `next build`) y
 * el spec §3.2 solo limita login, formularios públicos y creación de pedidos.
 */
@ApiTags('catalog')
@ApiExtraModels(ProductSummaryDto, ProductTabsDto, ProductOptionsDto, ImageDto)
@SkipThrottle()
@Controller('products')
export class ProductsController {
  /**
   * @param listProducts - Query del listado.
   * @param getProduct - Query de la ficha.
   * @param getRelatedProducts - Query de los relacionados.
   */
  constructor(
    private readonly listProducts: ListProductsQuery,
    private readonly getProduct: GetProductQuery,
    private readonly getRelatedProducts: GetRelatedProductsQuery,
  ) {}

  /**
   * Lista los productos publicados, paginados y filtrados.
   *
   * @param query - Filtros, orden y página ya validados (422 si alguno no sirve).
   * @returns La página con la forma `ProductPage` del contrato.
   */
  @Get()
  @ApiOperation({ operationId: 'listProducts', summary: 'Listar el catálogo publicado' })
  @ApiOkResponse({ type: ProductPageDto, description: 'Página de productos.' })
  @ApiProblemResponses(422, 429, 500)
  list(@Query() query: ListProductsQueryDto): Promise<ProductPage> {
    return this.listProducts.execute(query.toFilter())
  }

  /**
   * Devuelve la ficha de un producto publicado; con un slug anterior, el producto con su slug
   * actual (la tienda redirige).
   *
   * @param params - Slug de la ruta ya validado.
   * @returns La ficha con la forma `ProductDetail` del contrato.
   * @throws {NotFoundException} Si no hay un producto publicado con ese slug (404).
   */
  @Get(':slug')
  @ApiOperation({ operationId: 'getProduct', summary: 'Obtener la ficha de un producto' })
  @ApiOkResponse({ schema: schemaRef('ProductDetail'), description: 'Ficha del producto.' })
  @ApiProblemResponses(404, 422, 429, 500)
  async get(@Param() params: ProductSlugParamDto): Promise<ProductDetail> {
    const product = await this.getProduct.execute(params.slug)
    if (product === null) throw new NotFoundException(PRODUCT_NOT_FOUND)
    return product
  }

  /**
   * Devuelve hasta 4 relacionados: primero los de la misma línea y después los del mismo grupo.
   *
   * @param params - Slug de la ruta ya validado.
   * @returns Los relacionados (puede ser una lista vacía).
   * @throws {NotFoundException} Si no hay un producto publicado con ese slug (404).
   */
  @Get(':slug/related')
  @ApiOperation({ operationId: 'listRelatedProducts', summary: 'Listar los relacionados' })
  @ApiOkResponse({
    description: 'Productos relacionados (puede estar vacía).',
    schema: {
      type: 'array',
      maxItems: RELATED_PRODUCTS_LIMIT,
      items: { $ref: getSchemaPath(ProductSummaryDto) },
    },
  })
  @ApiProblemResponses(404, 422, 429, 500)
  async related(@Param() params: ProductSlugParamDto): Promise<ProductSummary[]> {
    const related = await this.getRelatedProducts.execute(params.slug)
    if (related === null) throw new NotFoundException(PRODUCT_NOT_FOUND)
    return related
  }
}
