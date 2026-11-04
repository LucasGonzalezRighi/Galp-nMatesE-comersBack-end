import { Controller, Get } from '@nestjs/common'
import {
  ApiExtraModels,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger'
import { SkipThrottle } from '@nestjs/throttler'

import { ApiProblemResponses, ImageDto } from '../../../shared/infrastructure/http/openapi'
import { ListCombosQuery } from '../application/queries/list-combos.query'
import type { ComboView } from '../application/read-models'
import { ComboDto, ComboItemDto } from './dto/catalog.response.dto'

/**
 * Combos a la venta de la tienda (`/combos`). Lee Postgres en cada pedido (sin caché del back):
 * la tienda ya cachea con las etiquetas `combos` y `products`.
 *
 * Sin límite de pedidos por IP, como `/products`: la tienda lee desde un solo servidor.
 */
@ApiTags('catalog')
@ApiExtraModels(ComboDto, ComboItemDto, ImageDto)
@SkipThrottle()
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
