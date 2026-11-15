import { Controller, Get } from '@nestjs/common'
import {
  ApiExtraModels,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger'

import { ApiProblemResponses, ImageDto } from '../../../shared/infrastructure/http/openapi'
import { PublicRead } from '../../../shared/infrastructure/throttler/public-read'
import { ListCombosQuery } from '../application/queries/list-combos.query'
import type { ComboView } from '../application/read-models'
import { ComboDto, ComboItemDto } from './dto/catalog.response.dto'

/**
 * Combos a la venta de la tienda (`/combos`). Lee Postgres en cada pedido (sin caché del back):
 * la tienda ya cachea con las etiquetas `combos` y `products`.
 *
 * Lectura pública (`@PublicRead()`, NV-18): límite de 300 pedidos por minuto por IP real del
 * cliente, que solo cuenta con `TRUST_PROXY`; el servidor de la tienda (SSR/ISR y `next build`)
 * no se limita.
 */
@ApiTags('catalog')
@ApiExtraModels(ComboDto, ComboItemDto, ImageDto)
@PublicRead()
@Controller('combos')
export class CombosController {
  /** @param listCombos - Query de los combos a la venta. */
  constructor(private readonly listCombos: ListCombosQuery) {}

  /**
   * Lista los combos publicados con todas sus piezas publicadas y con precio, por `position`.
   *
   * @returns Los combos con la forma `Combo` del contrato.
   */
  @Get()
  @ApiOperation({ operationId: 'listCombos', summary: 'Listar los combos a la venta' })
  @ApiOkResponse({
    description: 'Combos a la venta.',
    schema: {
      type: 'array',
      description: 'Combos ordenados por `position`.',
      items: { $ref: getSchemaPath(ComboDto) },
    },
  })
  @ApiProblemResponses(429, 500)
  list(): Promise<ComboView[]> {
    return this.listCombos.execute()
  }
}
