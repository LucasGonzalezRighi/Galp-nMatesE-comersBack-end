// Operaciones y casos de validación de contacto, arrepentimiento, bandeja y reseñas (Task 4 de
// B6). Los suman `openapi.contract.spec.ts` y `validation-cases.contract.spec.ts`.

import { authorNameOrAnonymous } from '../../../src/modules/reviews/domain/review-moderation'
import { AdminReviewUpdateDto } from '../../../src/modules/reviews/interface/dto/admin-reviews.dto'
import { ReviewInputDto } from '../../../src/modules/reviews/interface/dto/review-input.dto'
import { MessageUpdateDto } from '../../../src/modules/support/interface/dto/admin-messages.dto'
import {
  ContactInputDto,
  WithdrawalInputDto,
} from '../../../src/modules/support/interface/dto/contact-input.dto'
import {
  type Check,
  errorsOf,
  errorsOrAnyMessage,
  type Mapping,
  type ValidationCase,
  wholeCase,
} from '../validation-cases.support'

/** Operaciones de contacto, arrepentimiento, bandeja y reseñas que el back ya implementa. */
export const SUPPORT_PATHS: readonly string[] = [
  'POST /contact',
  'POST /withdrawals',
  'GET /admin/messages',
  'PATCH /admin/messages/{id}',
  'POST /products/{slug}/reviews',
  'GET /admin/reviews',
  'PATCH /admin/reviews/{id}',
]

/**
 * Casos que el contrato responde 202/201 sin guardar y que el schema del front marca inválidos:
 * el campo trampa con texto. El back no los rechaza (responde como si hubiera funcionado y no
 * guarda nada, ver `Honeypot`), así que no se comparan con el DTO; los cubren los E2E.
 */
const TRAP_CASES: readonly string[] = [
  'Campo trampa: con contenido en el contacto',
  'Campo trampa: con un solo espacio',
  'Campo trampa: con contenido en el arrepentimiento',
  'Campo trampa: con contenido en la reseña',
]

/**
 * El cuerpo del caso con los campos que el contrato declara `nullable` en `null` si el caso no los
 * trae: el front los omite, pero el contrato los pide y la tienda los manda en `null`.
 *
 * @param input - Cuerpo del caso.
 * @param nullable - Campos `nullable` del cuerpo.
 * @returns El cuerpo completo.
 */
function withNullDefaults(
  input: Record<string, unknown>,
  nullable: readonly string[],
): Record<string, unknown> {
  return { ...Object.fromEntries(nullable.map((field) => [field, null])), ...input }
}

/**
 * Un formulario público entero contra su schema, sin los casos del campo trampa con texto.
 *
 * @param schema - Schema del front.
 * @param nullable - Campos `nullable` que se completan con `null`.
 * @returns El armado del chequeo de cada caso.
 */
function publicFormCase(
  schema: string,
  nullable: readonly string[],
): (validationCase: ValidationCase) => Check | null {
  return (validationCase) =>
    validationCase.schema === schema && !TRAP_CASES.includes(validationCase.name)
      ? {
          body: withNullDefaults(validationCase.input, nullable),
          output: validationCase.output,
          errors: errorsOf(validationCase, (field) => field),
        }
      : null
}

/** DTOs de contacto, arrepentimiento, bandeja y reseñas contra los casos compartidos. */
export const SUPPORT_MAPPINGS: readonly Mapping[] = [
  {
    // Formulario de contacto (`POST /contact`): el DTO entero; el número de pedido vacío y el
    // campo trampa ausente quedan `null`, que la comparación omite como el front.
    name: 'ContactInputDto (contactSchema)',
    dto: ContactInputDto,
    check: publicFormCase('contactSchema', ['orderNumber', 'website']),
  },
  {
    // Botón de arrepentimiento (`POST /withdrawals`): el DTO entero; el comentario vacío queda
    // `null` (el front lo omite).
    name: 'WithdrawalInputDto (withdrawalSchema)',
    dto: WithdrawalInputDto,
    check: publicFormCase('withdrawalSchema', ['orderNumber', 'comment', 'website']),
  },
  {
    // Reseña (`POST /products/{slug}/reviews`): el DTO entero. El nombre vacío sale del DTO como
    // `null` y el caso de uso firma "Anónimo" (`authorNameOrAnonymous`, dominio).
    name: 'ReviewInputDto (reviewSchema)',
    dto: ReviewInputDto,
    effective: (value) => ({
      ...value,
      authorName: authorNameOrAnonymous(
        typeof value.authorName === 'string' ? value.authorName : null,
      ),
    }),
    check: publicFormCase('reviewSchema', ['authorName', 'website']),
  },
  {
    // Moderación (`PATCH /admin/reviews/{id}`): el DTO entero; sin cambios, el error de raíz
    // (`field: ''`) lo da el pipe con `RootRule`.
    name: 'AdminReviewUpdateDto (adminReviewUpdateSchema)',
    dto: AdminReviewUpdateDto,
    check: wholeCase('adminReviewUpdateSchema'),
  },
  {
    // Leído o no leído (`PATCH /admin/messages/{id}`): sin `read` solo tiene que fallar `read`.
    name: 'MessageUpdateDto (messageUpdateSchema)',
    dto: MessageUpdateDto,
    check: (c) =>
      c.schema === 'messageUpdateSchema'
        ? { body: c.input, output: c.output, errors: errorsOrAnyMessage(c) }
        : null,
  },
]
