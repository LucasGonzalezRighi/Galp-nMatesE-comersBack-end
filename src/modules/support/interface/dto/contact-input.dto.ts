import { ApiSchema } from '@nestjs/swagger'
import { IsIn, IsString, MaxLength, MinLength } from 'class-validator'

import { ApiSchemaProperty, namedRef } from '../../../../shared/infrastructure/http/openapi'
import { StorableText } from '../../../../shared/infrastructure/http/storable-text.validator'
import {
  EmailField,
  maxMessage,
  PersonNameField,
  RawValue,
  Trimmed,
} from '../../../identity/interface/dto/identity-fields'
import type { ContactInput } from '../../application/commands/send-contact-message.command'
import type { WithdrawalInput } from '../../application/commands/request-withdrawal.command'
import { CONTACT_REASONS, type ContactReason } from '../../domain/contact-message'
import {
  HoneypotField,
  NullableOrderNumberField,
  NullableTextField,
  PUBLIC_FORM_MESSAGES,
} from './public-form-fields'

/**
 * Mensaje del formulario de contacto (`ContactInput` del contrato, `contactSchema` del front).
 * Todos los campos tienen que venir; `orderNumber` y `website` pueden ser `null`.
 */
@ApiSchema({ name: 'ContactInput' })
export class ContactInputDto {
  /** Nombre, recortado, de 2 a 50 caracteres, que Postgres pueda guardar. */
  @ApiSchemaProperty({ type: 'string', minLength: 2, maxLength: 50 })
  @Trimmed()
  @StorableText(PUBLIC_FORM_MESSAGES.invalidText)
  @MaxLength(50, { message: maxMessage(50) })
  @MinLength(2, { message: PUBLIC_FORM_MESSAGES.contactName })
  @IsString({ message: PUBLIC_FORM_MESSAGES.contactName })
  name!: string

  /** Email, recortado y en minúsculas. */
  @EmailField()
  email!: string

  /** Número de pedido en mayúsculas, o `null`. */
  @NullableOrderNumberField()
  orderNumber!: string | null

  /** Motivo, con su texto exacto (`Envío` con tilde). */
  @ApiSchemaProperty(namedRef('ContactReason'))
  @RawValue()
  @IsIn(CONTACT_REASONS, { message: PUBLIC_FORM_MESSAGES.invalidContactReason })
  reason!: ContactReason

  /**
   * Mensaje, recortado, de 10 a 2000 caracteres, que Postgres pueda guardar (con U+0000 llegaba a
   * la base y respondía 500).
   */
  @ApiSchemaProperty({ type: 'string', minLength: 10, maxLength: 2000 })
  @Trimmed()
  @StorableText(PUBLIC_FORM_MESSAGES.invalidText)
  @MaxLength(2000, { message: maxMessage(2000) })
  @MinLength(10, { message: PUBLIC_FORM_MESSAGES.contactMessage })
  @IsString({ message: PUBLIC_FORM_MESSAGES.contactMessage })
  message!: string

  /** Campo trampa. */
  @HoneypotField()
  website!: string | null

  /**
   * El mensaje para `SendContactMessageCommand`.
   *
   * @returns Los campos ya normalizados.
   */
  toInput(): ContactInput {
    return {
      name: this.name,
      email: this.email,
      orderNumber: this.orderNumber,
      reason: this.reason,
      message: this.message,
      website: this.website,
    }
  }
}

/**
 * Solicitud de arrepentimiento (`WithdrawalInput` del contrato, `withdrawalSchema` del front):
 * nombre y email obligatorios; número de pedido y comentario pueden ser `null` (tienen que
 * venir igual, como dice el contrato).
 */
@ApiSchema({ name: 'WithdrawalInput' })
export class WithdrawalInputDto {
  /** Nombre (`PersonName`). */
  @PersonNameField()
  name!: string

  /** Email, recortado y en minúsculas. */
  @EmailField()
  email!: string

  /** Número de pedido en mayúsculas, o `null`. */
  @NullableOrderNumberField()
  orderNumber!: string | null

  /** Comentario recortado, de hasta 2000 caracteres, o `null`. */
  @NullableTextField(2000, maxMessage(2000))
  comment!: string | null

  /** Campo trampa. */
  @HoneypotField()
  website!: string | null

  /**
   * La solicitud para `RequestWithdrawalCommand`.
   *
   * @returns Los campos ya normalizados.
   */
  toInput(): WithdrawalInput {
    return {
      name: this.name,
      email: this.email,
      orderNumber: this.orderNumber,
      comment: this.comment,
      website: this.website,
    }
  }
}
