import { PickType } from '@nestjs/swagger'

import { PageQueryDto } from '../../../../shared/infrastructure/http/page.dto'

/** Pedidos por página de "Mis pedidos" (fijo: el contrato solo deja elegir la página). */
export const MY_ORDERS_PAGE_SIZE = 10

/**
 * Query de `GET /me/orders`: solo `page` (parámetro `Page` del contrato), con las mismas reglas
 * que el resto de las listas; `pageSize` u otro parámetro responden 422.
 */
export class MyOrdersQueryDto extends PickType(PageQueryDto, ['page'] as const) {}
