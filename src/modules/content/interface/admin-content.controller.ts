import { Body, Controller, Get, NotFoundException, Param, Put, UseGuards } from '@nestjs/common'
import {
  ApiBody,
  ApiCookieAuth,
  ApiExtraModels,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger'
import { SkipThrottle } from '@nestjs/throttler'

import type { SessionRecord } from '../../../shared/application/ports/session.port'
import { CurrentSession } from '../../../shared/infrastructure/auth/current-session.decorator'
import { adminUserIdOf } from '../../../shared/infrastructure/auth/session-ids'
import {
  AdminCsrfGuard,
  AdminSessionGuard,
} from '../../../shared/infrastructure/auth/session.guards'
import { ImageInputDto } from '../../../shared/infrastructure/http/image-input.dto'
import { ApiProblemResponses, schemaRef } from '../../../shared/infrastructure/http/openapi'
import { UpdateAboutContentCommand } from '../application/commands/update-about-content.command'
import {
  type PlainContentKey,
  UpdateContentCommand,
} from '../application/commands/update-content.command'
import { GetAdminContentQuery } from '../application/queries/get-admin-content.query'
import type {
  AboutContent,
  ContentByKey,
  FaqContent,
  FooterContent,
  HomeContent,
  LegalContent,
  ProductTabsContent,
} from '../application/read-models'
import {
  type ContentKey,
  isLegalDocument,
  LEGAL_DOCUMENTS,
  legalContentKey,
} from '../domain/content-key'
import { LEGAL_DOCUMENT_DESCRIPTION, LEGAL_DOCUMENT_NOT_FOUND } from './content.controller'
import {
  AboutContentInputDto,
  FaqContentInputDto,
  FooterContentInputDto,
  HomeContentInputDto,
  LegalContentInputDto,
  ProductTabsContentInputDto,
} from './dto/content-input.dto'
import { AboutContentInputSchemaDto } from './dto/content.response.dto'

/** Seguridad de las escrituras del dashboard: sesión de admin y token CSRF. */
const SESSION_AND_CSRF = { adminSession: [], csrfToken: [] }

/** Parámetro `{document}` (`LegalDocument` del contrato). */
const LEGAL_DOCUMENT_PARAM = {
  name: 'document',
  enum: [...LEGAL_DOCUMENTS],
  description: LEGAL_DOCUMENT_DESCRIPTION,
} as const

/**
 * Textos editables del dashboard (`/admin/content/*`): lectura y guardado de inicio, Nosotros,
 * preguntas frecuentes, pie, pestañas de la ficha y documentos legales. Las lecturas piden la
 * sesión de admin (401) y van a Postgres sin caché; los guardados piden además el token CSRF (403),
 * reemplazan el contenido completo y le avisan a la tienda qué regenerar (`storefront.stale` en el
 * outbox, en la misma transacción); un 4xx no avisa nada.
 *
 * El 404 de un documento legal que no es del contrato lo da el handler: el `ValidationPipe` corre
 * antes, así que un `PUT` con un cuerpo inválido a `/legal/otro` responde 422 (Ruling B-80, como
 * B-63).
 */
@ApiTags('admin')
@ApiExtraModels(ImageInputDto, AboutContentInputSchemaDto)
@SkipThrottle()
@Controller('admin/content')
export class AdminContentController {
  /**
   * @param getContent - Lectura sin caché de los contenidos.
   * @param updateContent - Guardado de los contenidos que van tal cual.
   * @param updateAbout - Guardado de Nosotros (resuelve las fotos).
   */
  constructor(
    private readonly getContent: GetAdminContentQuery,
    private readonly updateContent: UpdateContentCommand,
    private readonly updateAbout: UpdateAboutContentCommand,
  ) {}

  /** @returns Los textos del inicio. */
  @Get('home')
  @UseGuards(AdminSessionGuard)
  @ApiCookieAuth('adminSession')
  @ApiOperation({ operationId: 'getAdminHomeContent', summary: 'Obtener los textos del inicio' })
  @ApiOkResponse({ schema: schemaRef('HomeContent'), description: 'Textos.' })
  @ApiProblemResponses(401, 429, 500)
  home(): Promise<HomeContent> {
    return this.required('home')
  }

  /**
   * @param body - Inicio completo, ya validado y normalizado (422 si no).
   * @param session - Sesión de admin.
   * @returns Los textos guardados.
   */
  @Put('home')
  @UseGuards(AdminSessionGuard, AdminCsrfGuard)
  @ApiSecurity(SESSION_AND_CSRF)
  @ApiOperation({ operationId: 'updateAdminHomeContent', summary: 'Guardar los textos del inicio' })
  @ApiBody({ required: true, schema: schemaRef('HomeContent') })
  @ApiOkResponse({ schema: schemaRef('HomeContent'), description: 'Textos guardados.' })
  @ApiProblemResponses(401, 403, 422, 429, 500)
  saveHome(
    @Body() body: HomeContentInputDto,
    @CurrentSession() session: SessionRecord,
  ): Promise<HomeContent> {
    return this.save('home', body, session)
  }

  /** @returns Los textos de Nosotros. */
  @Get('about')
  @UseGuards(AdminSessionGuard)
  @ApiCookieAuth('adminSession')
  @ApiOperation({ operationId: 'getAdminAboutContent', summary: 'Obtener los textos de Nosotros' })
  @ApiOkResponse({ schema: schemaRef('AboutContent'), description: 'Textos.' })
  @ApiProblemResponses(401, 429, 500)
  about(): Promise<AboutContent> {
    return this.required('about')
  }

  /**
   * @param body - Nosotros completo, con la foto de cada socio como `ImageInput`.
   * @param session - Sesión de admin.
   * @returns Nosotros guardado, con las fotos armadas (422 `unknown_image` si una no existe).
   */
  @Put('about')
  @UseGuards(AdminSessionGuard, AdminCsrfGuard)
  @ApiSecurity(SESSION_AND_CSRF)
  @ApiOperation({
    operationId: 'updateAdminAboutContent',
    summary: 'Guardar los textos de Nosotros',
  })
  @ApiBody({ required: true, schema: schemaRef('AboutContentInput') })
  @ApiOkResponse({ schema: schemaRef('AboutContent'), description: 'Textos guardados.' })
  @ApiProblemResponses(401, 403, 422, 429, 500)
  saveAbout(
    @Body() body: AboutContentInputDto,
    @CurrentSession() session: SessionRecord,
  ): Promise<AboutContent> {
    return this.updateAbout.execute(body, adminUserIdOf(session))
  }

  /** @returns Los textos de las preguntas frecuentes. */
  @Get('faq')
  @UseGuards(AdminSessionGuard)
  @ApiCookieAuth('adminSession')
  @ApiOperation({
    operationId: 'getAdminFaqContent',
    summary: 'Obtener los textos de las preguntas frecuentes',
  })
  @ApiOkResponse({ schema: schemaRef('FaqContent'), description: 'Textos.' })
  @ApiProblemResponses(401, 429, 500)
  faq(): Promise<FaqContent> {
    return this.required('faq')
  }

  /**
   * @param body - Preguntas frecuentes completas.
   * @param session - Sesión de admin.
   * @returns Los textos guardados.
   */
  @Put('faq')
  @UseGuards(AdminSessionGuard, AdminCsrfGuard)
  @ApiSecurity(SESSION_AND_CSRF)
  @ApiOperation({
    operationId: 'updateAdminFaqContent',
    summary: 'Guardar los textos de las preguntas frecuentes',
  })
  @ApiBody({ required: true, schema: schemaRef('FaqContent') })
  @ApiOkResponse({ schema: schemaRef('FaqContent'), description: 'Textos guardados.' })
  @ApiProblemResponses(401, 403, 422, 429, 500)
  saveFaq(
    @Body() body: FaqContentInputDto,
    @CurrentSession() session: SessionRecord,
  ): Promise<FaqContent> {
    return this.save('faq', body, session)
  }

  /** @returns Los textos del pie de página. */
  @Get('footer')
  @UseGuards(AdminSessionGuard)
  @ApiCookieAuth('adminSession')
  @ApiOperation({
    operationId: 'getAdminFooterContent',
    summary: 'Obtener los textos del pie de página',
  })
  @ApiOkResponse({ schema: schemaRef('FooterContent'), description: 'Textos.' })
  @ApiProblemResponses(401, 429, 500)
  footer(): Promise<FooterContent> {
    return this.required('footer')
  }

  /**
   * @param body - Pie de página completo.
   * @param session - Sesión de admin.
   * @returns Los textos guardados.
   */
  @Put('footer')
  @UseGuards(AdminSessionGuard, AdminCsrfGuard)
  @ApiSecurity(SESSION_AND_CSRF)
  @ApiOperation({
    operationId: 'updateAdminFooterContent',
    summary: 'Guardar los textos del pie de página',
  })
  @ApiBody({ required: true, schema: schemaRef('FooterContent') })
  @ApiOkResponse({ schema: schemaRef('FooterContent'), description: 'Textos guardados.' })
  @ApiProblemResponses(401, 403, 422, 429, 500)
  saveFooter(
    @Body() body: FooterContentInputDto,
    @CurrentSession() session: SessionRecord,
  ): Promise<FooterContent> {
    return this.save('footer', body, session)
  }

  /** @returns Los textos de fábrica de las pestañas de la ficha. */
  @Get('product-tabs')
  @UseGuards(AdminSessionGuard)
  @ApiCookieAuth('adminSession')
  @ApiOperation({
    operationId: 'getAdminProductTabsContent',
    summary: 'Obtener los textos de las pestañas de la ficha',
  })
  @ApiOkResponse({ schema: schemaRef('ProductTabsContent'), description: 'Textos.' })
  @ApiProblemResponses(401, 429, 500)
  productTabs(): Promise<ProductTabsContent> {
    return this.required('product-tabs')
  }

  /**
   * @param body - Pestañas de la ficha completas.
   * @param session - Sesión de admin.
   * @returns Los textos guardados.
   */
  @Put('product-tabs')
  @UseGuards(AdminSessionGuard, AdminCsrfGuard)
  @ApiSecurity(SESSION_AND_CSRF)
  @ApiOperation({
    operationId: 'updateAdminProductTabsContent',
    summary: 'Guardar los textos de las pestañas de la ficha',
  })
  @ApiBody({ required: true, schema: schemaRef('ProductTabsContent') })
  @ApiOkResponse({ schema: schemaRef('ProductTabsContent'), description: 'Textos guardados.' })
  @ApiProblemResponses(401, 403, 422, 429, 500)
  saveProductTabs(
    @Body() body: ProductTabsContentInputDto,
    @CurrentSession() session: SessionRecord,
  ): Promise<ProductTabsContent> {
    return this.save('product-tabs', body, session)
  }

  /**
   * @param document - Documento de la ruta.
   * @returns El documento legal.
   * @throws {NotFoundException} Si no es un documento del contrato, o si no está cargado.
   */
  @Get('legal/:document')
  @UseGuards(AdminSessionGuard)
  @ApiCookieAuth('adminSession')
  @ApiOperation({ operationId: 'getAdminLegalContent', summary: 'Obtener un documento legal' })
  @ApiParam(LEGAL_DOCUMENT_PARAM)
  @ApiOkResponse({ schema: schemaRef('LegalContent'), description: 'Documento legal.' })
  @ApiProblemResponses(401, 404, 429, 500)
  async legal(@Param('document') document: string): Promise<LegalContent> {
    if (!isLegalDocument(document)) throw new NotFoundException(LEGAL_DOCUMENT_NOT_FOUND)
    const content = await this.getContent.execute(legalContentKey(document))
    if (content === null) throw new NotFoundException(LEGAL_DOCUMENT_NOT_FOUND)
    return content
  }

  /**
   * @param document - Documento de la ruta.
   * @param body - Documento completo, ya validado (el 422 va antes que el 404, Ruling B-80).
   * @param session - Sesión de admin.
   * @returns El documento guardado, con los marcadores `{{clave}}` tal cual (422 si una clave no
   *   está en `LEGAL_MARKERS`).
   * @throws {NotFoundException} Si no es un documento del contrato.
   */
  @Put('legal/:document')
  @UseGuards(AdminSessionGuard, AdminCsrfGuard)
  @ApiSecurity(SESSION_AND_CSRF)
  @ApiOperation({ operationId: 'updateAdminLegalContent', summary: 'Guardar un documento legal' })
  @ApiParam(LEGAL_DOCUMENT_PARAM)
  @ApiBody({ required: true, schema: schemaRef('LegalContent') })
  @ApiOkResponse({ schema: schemaRef('LegalContent'), description: 'Documento guardado.' })
  @ApiProblemResponses(401, 403, 404, 422, 429, 500)
  saveLegal(
    @Param('document') document: string,
    @Body() body: LegalContentInputDto,
    @CurrentSession() session: SessionRecord,
  ): Promise<LegalContent> {
    if (!isLegalDocument(document)) throw new NotFoundException(LEGAL_DOCUMENT_NOT_FOUND)
    return this.save(legalContentKey(document), body, session)
  }

  /**
   * Guarda un contenido que va tal cual, con el usuario de la sesión.
   *
   * @param key - Clave del contenido.
   * @param body - Contenido ya validado.
   * @param session - Sesión de admin.
   * @returns El contenido guardado.
   */
  private save<K extends PlainContentKey>(
    key: K,
    body: ContentByKey[K],
    session: SessionRecord,
  ): Promise<ContentByKey[K]> {
    return this.updateContent.execute(key, body, adminUserIdOf(session))
  }

  /**
   * Lee un contenido que el dashboard siempre necesita.
   *
   * @param key - Clave del contenido.
   * @returns El contenido con su forma del contrato.
   * @throws {Error} Si la clave no está cargada (falta correr el seed): sale como 500.
   */
  private async required<K extends ContentKey>(key: K): Promise<ContentByKey[K]> {
    const content = await this.getContent.execute(key)
    if (content === null) {
      throw new Error(`Falta el contenido "${key}" en content_blocks: corré npm run db:seed.`)
    }
    return content
  }
}
