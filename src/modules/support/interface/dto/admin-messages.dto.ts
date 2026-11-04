import { ApiPropertyOptional, ApiSchema, PickType } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import { IsBoolean, IsIn, IsOptional } from 'class-validator'

import { ApiSchemaProperty } from '../../../../shared/infrastructure/http/openapi'
import { PageQueryDto } from '../../../../shared/infrastructure/http/page.dto'
import { parseQueryBoolean } from '../../../catalog/interface/dto/list-products.query.dto'
import { RawValue } from '../../../identity/interface/dto/identity-fields'
import type { ContactMessageFilter } from '../../application/ports/contact-message.repository.port'
import { CONTACT_MESSAGE_KINDS, type ContactMessageKind } from '../../domain/contact-message'

/** Mensaje de un booleano de la bandeja que no es `true` ni `false` (el del mock). */
export const READ_FLAG_MESSAGE = 'El valor de read tiene que ser true o false.'

/**
 * Query de `GET /admin/messages`: `page`, `kind` y `read`, con los textos del mock del front. El
 * tamaño de página lo fija el back (20) y cualquier otro parámetro responde 422.
 */
export class AdminMessagesQueryDto extends PickType(PageQueryDto, ['page'] as const) {
  /** Solo los de ese tipo. */
  @ApiPropertyOptional({
    enum: [...CONTACT_MESSAGE_KINDS],
    enumName: 'ContactMessageKind',
    description: 'Tipo de mensaje; deja solo los de ese tipo.',
  })
  @IsOptional()
  @IsIn(CONTACT_MESSAGE_KINDS, {
    message: `El tipo de mensaje tiene que ser ${CONTACT_MESSAGE_KINDS.join(', ')}.`,
  })
  kind?: ContactMessageKind

  /** `true`: solo los leídos; `false`: solo los no leídos. */
  @ApiPropertyOptional({
    type: 'boolean',
    description: 'Con `true`, deja solo los mensajes leídos; con `false`, solo los no leídos.',
  })
  @IsOptional()
  @Transform(({ obj, key }: { obj: Record<string, unknown>; key: string }) =>
    parseQueryBoolean(obj[key]),
  )
  @IsBoolean({ message: READ_FLAG_MESSAGE })
  read?: boolean

  /**
   * Los filtros de la bandeja.
   *
   * @returns Tipo y leído (los que no vinieron quedan sin filtrar).
   */
  toFilter(): ContactMessageFilter {
    return { kind: this.kind, read: this.read }
  }
}

/** Cambio de un mensaje de la bandeja (`ContactMessageUpdate`): si queda leído o no. */
@ApiSchema({ name: 'ContactMessageUpdate' })
export class MessageUpdateDto {
  /** Si el mensaje queda leído; un booleano de JSON (`"true"` no pasa). */
  @ApiSchemaProperty({ type: 'boolean' })
  @RawValue()
  @IsBoolean({ message: READ_FLAG_MESSAGE })
  read!: boolean
}
