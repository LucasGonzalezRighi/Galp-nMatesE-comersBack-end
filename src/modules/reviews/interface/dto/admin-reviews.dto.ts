import { ApiPropertyOptional, PickType } from '@nestjs/swagger'
import { IsBoolean, IsIn, IsOptional, ValidateIf } from 'class-validator'

import { PageQueryDto } from '../../../../shared/infrastructure/http/page.dto'
import { RootRule } from '../../../../shared/infrastructure/http/validation.pipe'
import { RawValue } from '../../../identity/interface/dto/identity-fields'
import { REVIEW_STATUSES, type ReviewStatus } from '../../domain/review-moderation'

/** Textos de error de la moderación (los del front y el mock). */
export const ADMIN_REVIEW_MESSAGES = {
  /** Estado del cuerpo que no es uno de la lista. */
  status: 'Elegí un estado',
  /** `featured` que no es un booleano de JSON (no está en el front: nunca lo manda). */
  featured: 'Requerido',
  /** Cuerpo sin `status` ni `featured` (error de raíz). */
  emptyUpdate: 'Mandá al menos un cambio',
  /** `status` de la query que no es uno de la lista. */
  statusQuery: `El estado tiene que ser ${REVIEW_STATUSES.join(', ')}.`,
} as const

/**
 * Query de `GET /admin/reviews`: `page` y `status`, con los textos del mock. El tamaño de página
 * lo fija el back (20) y cualquier otro parámetro responde 422.
 */
export class AdminReviewsQueryDto extends PickType(PageQueryDto, ['page'] as const) {
  /** Solo las de ese estado. */
  @ApiPropertyOptional({
    enum: [...REVIEW_STATUSES],
    enumName: 'ReviewStatus',
    description: 'Estado de la reseña; deja solo las que están en ese estado.',
  })
  @IsOptional()
  @IsIn(REVIEW_STATUSES, { message: ADMIN_REVIEW_MESSAGES.statusQuery })
  status?: ReviewStatus
}

/** El campo vino en el cuerpo (un `null` también: lo rechaza su regla). */
const present = (_object: object, value: unknown): boolean => value !== undefined

/**
 * Cambio de una reseña (`AdminReviewUpdate`, `adminReviewUpdateSchema` del front): solo los campos
 * que vienen, al menos uno. Sin ninguno, el pipe responde el error de raíz (`field: ''`,
 * `empty_update`, "Mandá al menos un cambio"). Swagger lo declara con el esquema del contrato
 * (`minProperties: 1`), en `REVIEWS_OPENAPI_SCHEMAS`.
 */
@RootRule({
  name: 'reviewUpdateNotEmpty',
  code: 'empty_update',
  message: ADMIN_REVIEW_MESSAGES.emptyUpdate,
  isValid: (value) => {
    const update = value as Partial<AdminReviewUpdateDto>
    return update.status !== undefined || update.featured !== undefined
  },
})
export class AdminReviewUpdateDto {
  /** Estado nuevo. */
  @ValidateIf(present)
  @RawValue()
  @IsIn(REVIEW_STATUSES, { message: ADMIN_REVIEW_MESSAGES.status })
  status?: ReviewStatus

  /** Destacada o no (un booleano de JSON: `"true"` no pasa). */
  @ValidateIf(present)
  @RawValue()
  @IsBoolean({ message: ADMIN_REVIEW_MESSAGES.featured })
  featured?: boolean
}
