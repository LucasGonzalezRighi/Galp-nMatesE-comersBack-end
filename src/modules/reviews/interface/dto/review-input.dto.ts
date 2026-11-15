import { ApiSchema } from '@nestjs/swagger'
import { IsNumber, IsString, Max, MaxLength, Min, MinLength, ValidateBy } from 'class-validator'

import { ApiSchemaProperty } from '../../../../shared/infrastructure/http/openapi'
import { StorableText } from '../../../../shared/infrastructure/http/storable-text.validator'
import { maxMessage, RawValue, Trimmed } from '../../../identity/interface/dto/identity-fields'
import {
  HoneypotField,
  NullableTextField,
  PUBLIC_FORM_MESSAGES,
} from '../../../support/interface/dto/public-form-fields'
import type { ReviewInput } from '../../application/commands/submit-review.command'
import { AUTHOR_NAME_MAX_LENGTH } from '../../domain/review-moderation'

/** Textos de error de la reseña, los mismos que `MESSAGES` del front. */
export const REVIEW_INPUT_MESSAGES = {
  /** Puntuación que no es un número de 1 a 5 en pasos de media estrella. */
  rating: 'Elegí una puntuación de 1 a 5 estrellas.',
  /** Texto de menos de 10 caracteres. */
  text: 'Contanos un poco más (mínimo 10 caracteres)',
} as const

/**
 * Reseña que manda un visitante (`ReviewInput` del contrato, `reviewSchema` del front). Todos los
 * campos tienen que venir; `authorName` y `website` pueden ser `null`. El nombre vacío llega como
 * `null` y el caso de uso firma "Anónimo".
 */
@ApiSchema({ name: 'ReviewInput' })
export class ReviewInputDto {
  /** Puntuación de 1 a 5, en pasos de media estrella (un número de JSON: `"5"` no pasa). */
  @ApiSchemaProperty({ type: 'number', multipleOf: 0.5, minimum: 1, maximum: 5 })
  @RawValue()
  @ValidateBy(
    {
      name: 'notMultipleOf',
      validator: { validate: (value) => typeof value !== 'number' || Number.isInteger(value * 2) },
    },
    { message: REVIEW_INPUT_MESSAGES.rating },
  )
  @Max(5, { message: REVIEW_INPUT_MESSAGES.rating })
  @Min(1, { message: REVIEW_INPUT_MESSAGES.rating })
  @IsNumber({ allowNaN: false, allowInfinity: false }, { message: REVIEW_INPUT_MESSAGES.rating })
  rating!: number

  /** Nombre recortado, de hasta 40 caracteres, o `null` (vacío también queda `null`). */
  @NullableTextField(AUTHOR_NAME_MAX_LENGTH, maxMessage(AUTHOR_NAME_MAX_LENGTH))
  authorName!: string | null

  /** Texto recortado, de 10 a 600 caracteres, que Postgres pueda guardar. */
  @ApiSchemaProperty({ type: 'string', minLength: 10, maxLength: 600 })
  @Trimmed()
  @StorableText(PUBLIC_FORM_MESSAGES.invalidText)
  @MaxLength(600, { message: maxMessage(600) })
  @MinLength(10, { message: REVIEW_INPUT_MESSAGES.text })
  @IsString({ message: REVIEW_INPUT_MESSAGES.text })
  text!: string

  /** Campo trampa. */
  @HoneypotField()
  website!: string | null

  /**
   * La reseña para `SubmitReviewCommand`.
   *
   * @returns Los campos ya normalizados.
   */
  toInput(): ReviewInput {
    return {
      rating: this.rating,
      authorName: this.authorName,
      text: this.text,
      website: this.website,
    }
  }
}
