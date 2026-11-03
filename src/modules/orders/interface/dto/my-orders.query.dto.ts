import { PickType } from '@nestjs/swagger'

import { PageQueryDto } from '../../../../shared/infrastructure/http/page.dto'

/**
 * Query de `GET /me/orders`: solo `page` (parámetro `Page` del contrato), con las mismas reglas
 * que el resto de las listas; `pageSize` u otro parámetro responden 422 (el back pagina de a 10).
 */
export class MyOrdersQueryDto extends PickType(PageQueryDto, ['page'] as const) {}
