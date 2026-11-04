import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common'
import {
  ApiBody,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger'
import { SkipThrottle } from '@nestjs/throttler'

import {
  AdminCsrfGuard,
  AdminSessionGuard,
} from '../../../shared/infrastructure/auth/session.guards'
import { ApiProblemResponses, schemaRef } from '../../../shared/infrastructure/http/openapi'
import { ArchiveProductCommand } from '../application/commands/archive-product.command'
import { CreateProductCommand } from '../application/commands/create-product.command'
import { UpdateProductCommand } from '../application/commands/update-product.command'
import { GetAdminProductQuery } from '../application/queries/get-admin-product.query'
import { ListAdminProductsQuery } from '../application/queries/list-admin-products.query'
import type { AdminProduct, AdminProductPage } from '../application/read-models'
import { AdminProductInputDto, ProductTabsOverrideDto } from './dto/admin-product-input.dto'
import { AdminProductsQueryDto } from './dto/admin-products.query.dto'

/** Seguridad de las escrituras del dashboard: sesión de admin y token CSRF. */
const SESSION_AND_CSRF = { adminSession: [], csrfToken: [] }

/** Parámetro `{id}` de un producto (`AdminProductId` del contrato). */
const PRODUCT_ID_PARAM = {
  name: 'id',
  description: 'Identificador de un producto.',
  schema: { type: 'string', minLength: 1, maxLength: 80 },
} as const

/**
 * Productos del dashboard (`/admin/products`): listado, alta, consulta, edición y archivo, en
 * cualquier estado y sin caché. Las lecturas piden la sesión de admin (401) y las escrituras,
 * además, el token CSRF (403). Cada escritura avisa a la tienda (`storefront.stale`) en la misma
 * transacción y sube la versión de la caché del catálogo; un 4xx no avisa nada.
 *
 * El `ValidationPipe` corre antes que el caso de uso: un `PATCH` con un cuerpo inválido a un id
 * que no existe responde 422 (Ruling B-63/B-80).
 */
@ApiTags('admin')
@ApiExtraModels(AdminProductInputDto, ProductTabsOverrideDto)
@SkipThrottle()
@Controller('admin/products')
export class AdminProductsController {
  /**
   * @param listProducts - Listado.
   * @param getProduct - Consulta.
   * @param createProduct - Alta.
   * @param updateProduct - Edición.
   * @param archiveProduct - Archivo.
   */
  constructor(
    private readonly listProducts: ListAdminProductsQuery,
    private readonly getProduct: GetAdminProductQuery,
    private readonly createProduct: CreateProductCommand,
    private readonly updateProduct: UpdateProductCommand,
    private readonly archiveProduct: ArchiveProductCommand,
  ) {}

  /**
   * Lista los productos con filtros y página (sin `status`, todos menos los archivados).
   *
   * @param query - Filtros ya validados (422 con los textos del mock si no).
   * @returns La página (`AdminProductPage`).
   */
  @Get()
  @UseGuards(AdminSessionGuard)
  @ApiCookieAuth('adminSession')
  @ApiOperation({ operationId: 'listAdminProducts', summary: 'Listar los productos del dashboard' })
  @ApiOkResponse({ schema: schemaRef('AdminProductPage'), description: 'Página de productos.' })
  @ApiProblemResponses(401, 422, 429, 500)
  list(@Query() query: AdminProductsQueryDto): Promise<AdminProductPage> {
    return this.listProducts.execute(query.toQuery())
  }

  /**
   * Crea un producto; el back le asigna el código correlativo.
   *
   * @param body - Producto ya validado en su forma.
   * @returns El producto creado (201).
   */
  @Post()
  @UseGuards(AdminSessionGuard, AdminCsrfGuard)
  @ApiSecurity(SESSION_AND_CSRF)
  @ApiOperation({ operationId: 'createAdminProduct', summary: 'Crear un producto' })
  @ApiBody({ required: true, schema: schemaRef('AdminProductInput') })
  @ApiCreatedResponse({ schema: schemaRef('AdminProduct'), description: 'Producto creado.' })
  @ApiProblemResponses(401, 403, 409, 422, 429, 500)
  create(@Body() body: AdminProductInputDto): Promise<AdminProduct> {
    return this.createProduct.execute(body.toFields())
  }

  /**
   * Devuelve un producto en cualquier estado. El `422` está declarado porque el contrato lo
   * declara, aunque esta ruta nunca lo devuelve.
   *
   * @param id - Id del producto.
   * @returns El producto (`AdminProduct`).
   */
  @Get(':id')
  @UseGuards(AdminSessionGuard)
  @ApiCookieAuth('adminSession')
  @ApiOperation({ operationId: 'getAdminProduct', summary: 'Obtener un producto del dashboard' })
  @ApiParam(PRODUCT_ID_PARAM)
  @ApiOkResponse({ schema: schemaRef('AdminProduct'), description: 'Producto.' })
  @ApiProblemResponses(401, 404, 422, 429, 500)
  get(@Param('id') id: string): Promise<AdminProduct> {
    return this.getProduct.execute(id)
  }

  /**
   * Reemplaza los datos editables del producto (el cuerpo lleva el producto completo).
   *
   * @param id - Id del producto.
   * @param body - Producto ya validado en su forma, con `expectedUpdatedAt` opcional.
   * @returns El producto modificado.
   */
  @Patch(':id')
  @UseGuards(AdminSessionGuard, AdminCsrfGuard)
  @ApiSecurity(SESSION_AND_CSRF)
  @ApiOperation({ operationId: 'updateAdminProduct', summary: 'Modificar un producto' })
  @ApiParam(PRODUCT_ID_PARAM)
  @ApiBody({ required: true, schema: schemaRef('AdminProductInput') })
  @ApiOkResponse({ schema: schemaRef('AdminProduct'), description: 'Producto modificado.' })
  @ApiProblemResponses(401, 403, 404, 409, 422, 429, 500)
  update(@Param('id') id: string, @Body() body: AdminProductInputDto): Promise<AdminProduct> {
    return this.updateProduct.execute(id, body.toFields(), body.expectedUpdatedAt ?? null)
  }

  /**
   * Archiva el producto (sale de la tienda; se conserva con sus pedidos). El `422` está
   * declarado porque el contrato lo declara, aunque esta ruta nunca lo devuelve.
   *
   * @param id - Id del producto.
   * @returns El producto archivado (200).
   */
  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdminSessionGuard, AdminCsrfGuard)
  @ApiSecurity(SESSION_AND_CSRF)
  @ApiOperation({ operationId: 'archiveAdminProduct', summary: 'Archivar un producto' })
  @ApiParam(PRODUCT_ID_PARAM)
  @ApiOkResponse({ schema: schemaRef('AdminProduct'), description: 'Producto archivado.' })
  @ApiProblemResponses(401, 403, 404, 422, 429, 500)
  archive(@Param('id') id: string): Promise<AdminProduct> {
    return this.archiveProduct.execute(id)
  }
}
