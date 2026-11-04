import { ApiPropertyOptional, IntersectionType, PickType } from '@nestjs/swagger'
import { Transform, type TransformFnParams } from 'class-transformer'
import { IsIn, IsOptional, MaxLength } from 'class-validator'

import { PageQueryDto } from '../../../../shared/infrastructure/http/page.dto'
import {
  ORDER_STATUSES,
  type OrderStatus,
  PAYMENT_STATUSES,
  type PaymentStatus,
} from '../../domain/order-status'

/** Error de un estado del pedido que no existe (el texto del `QueryReader` del mock). */
export const INVALID_ORDER_STATUS_MESSAGE = `El estado tiene que ser ${ORDER_STATUSES.join(', ')}.`

/** Error de un estado del pago que no existe (el texto del `QueryReader` del mock). */
export const INVALID_PAYMENT_STATUS_MESSAGE = `El estado del pago tiene que ser ${PAYMENT_STATUSES.join(', ')}.`

/** Largo máximo del texto a buscar. */
export const ADMIN_ORDERS_QUERY_MAX_LENGTH = 100

/** Error de un texto a buscar demasiado largo (el del mock). */
export const QUERY_TOO_LONG_MESSAGE = `El texto no puede pasar de ${String(ADMIN_ORDERS_QUERY_MAX_LENGTH)} caracteres.`

/**
 * Valor de un parámetro que se lee una sola vez: si se repite, el primero (como
 * `URLSearchParams.get` del mock); vacío cuenta como ausente.
 */
function firstValue({ obj, key }: TransformFnParams): unknown {
  const raw: unknown = (obj as Record<string, unknown>)[key]
  const value: unknown = Array.isArray(raw) ? raw[0] : raw
  return value === '' ? undefined : value
}

/**
 * Lista de estados: Express deja un texto si `status` vino una vez y una lista si se repitió
 * (`?status=paid&status=preparing`); se descartan los vacíos y, si no queda ninguno, cuenta como
 * ausente (como `QueryReader.manyOf` del mock).
 */
function statusList({ obj, key }: TransformFnParams): unknown {
  const raw: unknown = (obj as Record<string, unknown>)[key]
  if (raw === undefined) return undefined
  const values = (Array.isArray(raw) ? raw : [raw]).filter((value: unknown) => value !== '')
  return values.length === 0 ? undefined : values
}

/**
 * Filtros del listado: `paymentStatus`, `q` (hasta 100 caracteres, sin recortar antes de medir)
 * y `status` repetible. `status` no lleva `@ApiProperty`: lo declara el controlador con
 * `@ApiQuery` (`style: form`, `explode: true`).
 */
class AdminOrderFiltersQueryDto {
  /** Estado del pago. */
  @ApiPropertyOptional({
    enum: [...PAYMENT_STATUSES],
    enumName: 'PaymentStatus',
    description: 'Estado del pago; deja solo los pedidos con ese estado de pago.',
  })
  @Transform(firstValue)
  @IsOptional()
  @IsIn(PAYMENT_STATUSES, { message: INVALID_PAYMENT_STATUS_MESSAGE })
  paymentStatus?: PaymentStatus

  /** Texto a buscar en el número y en el nombre y el email del cliente. */
  @ApiPropertyOptional({
    type: 'string',
    maxLength: ADMIN_ORDERS_QUERY_MAX_LENGTH,
    description:
      'Texto a buscar en el número de pedido y en el nombre y el email del cliente. No distingue acentos ni mayúsculas.',
  })
  @Transform(firstValue)
  @IsOptional()
  @MaxLength(ADMIN_ORDERS_QUERY_MAX_LENGTH, { message: QUERY_TOO_LONG_MESSAGE })
  q?: string

  /** Estados del pedido (alguno de ellos). */
  @Transform(statusList)
  @IsOptional()
  @IsIn(ORDER_STATUSES, { each: true, message: INVALID_ORDER_STATUS_MESSAGE })
  status?: OrderStatus[]
}

/**
 * Query de `GET /admin/orders`: `page` (las reglas de las demás listas) y los filtros. Se arma con
 * `IntersectionType` para que los errores salgan juntos en el orden del mock (página, pago,
 * texto, estado): `class-validator` informa primero las propiedades propias de una clase y
 * después las heredadas. `pageSize` u otro parámetro responden 422 "Este campo no está
 * permitido." (el back pagina de a 20).
 */
export class AdminOrdersQueryDto extends IntersectionType(
  PickType(PageQueryDto, ['page'] as const),
  AdminOrderFiltersQueryDto,
) {}
