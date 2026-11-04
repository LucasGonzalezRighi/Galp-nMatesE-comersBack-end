import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common'
import {
  ApiBody,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiSecurity,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger'
import { SkipThrottle } from '@nestjs/throttler'

import {
  AdminCsrfGuard,
  AdminSessionGuard,
} from '../../../shared/infrastructure/auth/session.guards'
import { ApiProblemResponses, schemaRef } from '../../../shared/infrastructure/http/openapi'
import { CreateCategoryCommand } from '../application/commands/create-category.command'
import { DeleteCategoryCommand } from '../application/commands/delete-category.command'
import { ReorderCategoriesCommand } from '../application/commands/reorder-categories.command'
import { UpdateCategoryCommand } from '../application/commands/update-category.command'
import { ListAdminCategoriesQuery } from '../application/queries/list-admin-categories.query'
import type { Category } from '../application/read-models'
import { CategoryDto } from './dto/catalog.response.dto'
import { CategoryInputDto, CategoryOrderInputDto } from './dto/category-input.dto'

/** Seguridad de las escrituras del dashboard: sesión de admin y token CSRF. */
const SESSION_AND_CSRF = { adminSession: [], csrfToken: [] }

/** Parámetro `{id}` de una línea (`AdminCategoryId` del contrato). */
const CATEGORY_ID_PARAM = {
  name: 'id',
  description: 'Identificador de una línea de producto.',
  schema: { type: 'string', minLength: 1, maxLength: 80 },
} as const

/**
 * Líneas del dashboard (`/admin/categories`): listado, alta, orden, edición y borrado, sin caché.
 * Las lecturas piden la sesión de admin (401) y las escrituras, además, el token CSRF (403).
 * Cada escritura avisa a la tienda (`categories`, `products`) en la misma transacción y sube la
 * versión de la caché del catálogo; un 4xx no avisa nada.
 */
@ApiTags('admin')
@ApiExtraModels(CategoryDto, CategoryInputDto, CategoryOrderInputDto)
@SkipThrottle()
@Controller('admin/categories')
export class AdminCategoriesController {
  /**
   * @param listCategories - Listado sin caché.
   * @param createCategory - Alta.
   * @param updateCategory - Edición.
   * @param deleteCategory - Borrado.
   * @param reorderCategories - Orden.
   */
  constructor(
    private readonly listCategories: ListAdminCategoriesQuery,
    private readonly createCategory: CreateCategoryCommand,
    private readonly updateCategory: UpdateCategoryCommand,
    private readonly deleteCategory: DeleteCategoryCommand,
    private readonly reorderCategories: ReorderCategoriesCommand,
  ) {}

  /**
   * Lista todas las líneas por `position`, con sus productos publicados.
   *
   * @returns Las líneas (`Category`).
   */
  @Get()
  @UseGuards(AdminSessionGuard)
  @ApiCookieAuth('adminSession')
  @ApiOperation({ operationId: 'listAdminCategories', summary: 'Listar las líneas del dashboard' })
  @ApiOkResponse({
    description: 'Líneas de producto.',
    schema: {
      type: 'array',
      description: 'Líneas ordenadas por `position`.',
      items: { $ref: getSchemaPath(CategoryDto) },
    },
  })
  @ApiProblemResponses(401, 429, 500)
  list(): Promise<Category[]> {
    return this.listCategories.execute()
  }

  /**
   * Crea una línea al final del listado.
   *
   * @param body - Línea ya validada en su forma.
   * @returns La línea creada (201).
   */
  @Post()
  @UseGuards(AdminSessionGuard, AdminCsrfGuard)
  @ApiSecurity(SESSION_AND_CSRF)
  @ApiOperation({ operationId: 'createAdminCategory', summary: 'Crear una línea' })
  @ApiBody({ required: true, schema: schemaRef('CategoryInput') })
  @ApiCreatedResponse({ schema: schemaRef('Category'), description: 'Línea creada.' })
  @ApiProblemResponses(401, 403, 409, 422, 429, 500)
  create(@Body() body: CategoryInputDto): Promise<Category> {
    return this.createCategory.execute(body.toFields())
  }

  /**
   * Fija el orden del listado: `ids` trae todas las líneas, una vez cada una.
   *
   * @param body - Orden nuevo ya validado en su forma.
   */
  @Put('order')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(AdminSessionGuard, AdminCsrfGuard)
  @ApiSecurity(SESSION_AND_CSRF)
  @ApiOperation({ operationId: 'reorderAdminCategories', summary: 'Reordenar las líneas' })
  @ApiBody({ required: true, schema: schemaRef('CategoryOrderInput') })
  @ApiNoContentResponse({ description: 'Orden guardado.' })
  @ApiProblemResponses(401, 403, 422, 429, 500)
  async reorder(@Body() body: CategoryOrderInputDto): Promise<void> {
    await this.reorderCategories.execute(body.ids)
  }

  /**
   * Reemplaza los datos de la línea; conserva su `position`.
   *
   * @param id - Id de la línea.
   * @param body - Línea completa ya validada en su forma.
   * @returns La línea modificada.
   */
  @Patch(':id')
  @UseGuards(AdminSessionGuard, AdminCsrfGuard)
  @ApiSecurity(SESSION_AND_CSRF)
  @ApiOperation({ operationId: 'updateAdminCategory', summary: 'Modificar una línea' })
  @ApiParam(CATEGORY_ID_PARAM)
  @ApiBody({ required: true, schema: schemaRef('CategoryInput') })
  @ApiOkResponse({ schema: schemaRef('Category'), description: 'Línea modificada.' })
  @ApiProblemResponses(401, 403, 404, 409, 422, 429, 500)
  update(@Param('id') id: string, @Body() body: CategoryInputDto): Promise<Category> {
    return this.updateCategory.execute(id, body.toFields())
  }

  /**
   * Borra una línea sin productos y renumera las demás. El `422` está declarado porque el
   * contrato lo declara, aunque esta ruta nunca lo devuelve.
   *
   * @param id - Id de la línea.
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(AdminSessionGuard, AdminCsrfGuard)
  @ApiSecurity(SESSION_AND_CSRF)
  @ApiOperation({ operationId: 'deleteAdminCategory', summary: 'Borrar una línea' })
  @ApiParam(CATEGORY_ID_PARAM)
  @ApiNoContentResponse({ description: 'Línea borrada.' })
  @ApiProblemResponses(401, 403, 404, 409, 422, 429, 500)
  async remove(@Param('id') id: string): Promise<void> {
    await this.deleteCategory.execute(id)
  }
}
