import { Controller, Get, NotFoundException, Param } from '@nestjs/common'
import { ApiExtraModels, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger'
import { SkipThrottle } from '@nestjs/throttler'

import { ApiProblemResponses, ImageDto } from '../../../shared/infrastructure/http/openapi'
import { GetContentQuery } from '../application/queries/get-content.query'
import type {
  AboutContent,
  ContentByKey,
  FaqContent,
  FooterContent,
  HomeContent,
  LegalContent,
  ProductTabsContent,
} from '../application/read-models'
import { type ContentKey, LEGAL_DOCUMENTS, type LegalDocument } from '../domain/content-key'
import {
  AboutContentDto,
  FaqContentDto,
  FooterContentDto,
  HomeContentDto,
  LegalContentDto,
  ProductTabsContentDto,
  StorySceneDto,
} from './dto/content.response.dto'

/** Detalle del 404 de un documento legal que no es `terms` ni `privacy` (el mismo que el mock). */
export const LEGAL_DOCUMENT_NOT_FOUND = 'No existe ese documento legal.'

/**
 * Indica si un texto de la ruta es un documento legal del contrato.
 *
 * @param value - Texto de `{document}`.
 * @returns `true` si es `terms` o `privacy`.
 */
function isLegalDocument(value: string): value is LegalDocument {
  return (LEGAL_DOCUMENTS as readonly string[]).includes(value)
}

/**
 * Textos editables de la tienda (`/content/*`).
 *
 * Sin límite de pedidos por IP: la tienda lee desde un solo servidor (SSR/ISR y `next build`) y
 * el spec §3.2 solo limita login, formularios públicos y creación de pedidos.
 */
@ApiTags('content')
@ApiExtraModels(ImageDto, StorySceneDto)
@SkipThrottle()
@Controller('content')
export class ContentController {
  /** @param getContent - Query de los contenidos por clave. */
  constructor(private readonly getContent: GetContentQuery) {}

  /** @returns Los textos del inicio. */
  @Get('home')
  @ApiOperation({ operationId: 'getHomeContent', summary: 'Obtener los textos del inicio' })
  @ApiOkResponse({ type: HomeContentDto, description: 'Textos del inicio.' })
  @ApiProblemResponses(429, 500)
  home(): Promise<HomeContent> {
    return this.required('home')
  }

  /** @returns Los textos de Nosotros. */
  @Get('about')
  @ApiOperation({ operationId: 'getAboutContent', summary: 'Obtener los textos de Nosotros' })
  @ApiOkResponse({ type: AboutContentDto, description: 'Textos de Nosotros.' })
  @ApiProblemResponses(429, 500)
  about(): Promise<AboutContent> {
    return this.required('about')
  }

  /** @returns Las preguntas frecuentes por categoría. */
  @Get('faq')
  @ApiOperation({ operationId: 'getFaqContent', summary: 'Obtener las preguntas frecuentes' })
  @ApiOkResponse({ type: FaqContentDto, description: 'Preguntas frecuentes.' })
  @ApiProblemResponses(429, 500)
  faq(): Promise<FaqContent> {
    return this.required('faq')
  }

  /** @returns Los textos del pie. */
  @Get('footer')
  @ApiOperation({ operationId: 'getFooterContent', summary: 'Obtener los textos del pie' })
  @ApiOkResponse({ type: FooterContentDto, description: 'Textos del pie.' })
  @ApiProblemResponses(429, 500)
  footer(): Promise<FooterContent> {
    return this.required('footer')
  }

  /** @returns Los textos de fábrica de las pestañas de la ficha, por grupo. */
  @Get('product-tabs')
  @ApiOperation({
    operationId: 'getProductTabsContent',
    summary: 'Obtener los textos de las pestañas de producto',
  })
  @ApiOkResponse({ type: ProductTabsContentDto, description: 'Textos de las pestañas.' })
  @ApiProblemResponses(429, 500)
  productTabs(): Promise<ProductTabsContent> {
    return this.required('product-tabs')
  }

  /**
   * Devuelve los términos y condiciones (`terms`) o la política de privacidad (`privacy`).
   *
   * @param document - Documento de la ruta.
   * @returns El documento legal.
   * @throws {NotFoundException} Si no es `terms` ni `privacy`, o si no está cargado (404, como
   *   dice el contrato).
   */
  @Get('legal/:document')
  @ApiOperation({ operationId: 'getLegalContent', summary: 'Obtener un documento legal' })
  @ApiParam({
    name: 'document',
    enum: [...LEGAL_DOCUMENTS],
    description: 'Documento legal: `terms` o `privacy`.',
  })
  @ApiOkResponse({ type: LegalContentDto, description: 'Documento legal.' })
  @ApiProblemResponses(404, 429, 500)
  async legal(@Param('document') document: string): Promise<LegalContent> {
    if (!isLegalDocument(document)) throw new NotFoundException(LEGAL_DOCUMENT_NOT_FOUND)
    const content = await this.getContent.execute(
      document === 'terms' ? 'legal-terms' : 'legal-privacy',
    )
    if (content === null) throw new NotFoundException(LEGAL_DOCUMENT_NOT_FOUND)
    return content
  }

  /**
   * Lee un contenido que la tienda siempre necesita.
   *
   * @param key - Clave del contenido.
   * @returns El contenido con su forma del contrato.
   * @throws {Error} Si la clave no está cargada (falta correr el seed): sale como 500, porque el
   *   contrato no prevé que falte.
   */
  private async required<K extends ContentKey>(key: K): Promise<ContentByKey[K]> {
    const content = await this.getContent.execute(key)
    if (content === null) {
      throw new Error(`Falta el contenido "${key}" en content_blocks: corré npm run db:seed.`)
    }
    return content
  }
}
