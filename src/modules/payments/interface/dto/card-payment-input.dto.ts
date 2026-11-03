import { ApiSchema } from '@nestjs/swagger'
import { Transform, type TransformFnParams, Type } from 'class-transformer'
import {
  IsDefined,
  IsInt,
  IsObject,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateBy,
  ValidateIf,
  ValidateNested,
  type ValidationArguments,
} from 'class-validator'

import {
  EmailField,
  IDENTITY_MESSAGES,
  maxMessage,
  RawValue,
  Trimmed,
} from '../../../identity/interface/dto/identity-fields'
import { ApiSchemaProperty, schemaRef } from '../../../../shared/infrastructure/http/openapi'
import type { CardPaymentInput } from '../../application/commands/pay-with-card.command'

/** Textos de error del pago con tarjeta (los del documento son los de `cardholderSchema`). */
export const CARD_PAYMENT_MESSAGES = {
  /** Token vacío, demasiado largo o que no es texto (el mismo que el de la pasarela). */
  token: 'El token de la tarjeta no es válido. Volvé a cargar la tarjeta.',
  /** Marca vacía, demasiado larga o que no es texto. */
  paymentMethodId: 'La marca de la tarjeta no es válida.',
  /** Banco emisor ausente, vacío, demasiado largo o que no es texto ni `null`. */
  issuerId: 'El banco emisor no es válido.',
  /** Cuotas fuera de 1 a 24 o que no son un entero (el mismo que el de la pasarela). */
  installments: 'Esa cantidad de cuotas no está disponible para esta tarjeta.',
  /** Falta el pagador o no es un objeto. */
  payer: 'Completá los datos de quien paga.',
  /** Falta el documento o no es un objeto. */
  identification: 'Completá el documento de quien paga.',
  /** Tipo de documento vacío (`MESSAGES.required` del front). */
  identificationType: IDENTITY_MESSAGES.required,
  /** DNI que no tiene 7 u 8 dígitos (`MESSAGES.invalidDni`). */
  invalidDni: 'DNI inválido',
  /** Otro documento que no es de 5 a 20 letras o números (`MESSAGES.invalidDocument`). */
  invalidDocument: 'Documento inválido',
} as const

/** Tipo de documento que se valida como DNI. */
const DNI_TYPE = 'DNI'

/** DNI sin puntos ni espacios: 7 u 8 dígitos. */
const DNI_PATTERN = /^\d{7,8}$/

/** Patrón del número de documento del contrato (y de los demás tipos). */
const DOCUMENT_PATTERN = /^[A-Za-z0-9]{5,20}$/

/** Largo máximo del token de la tarjeta. */
const TOKEN_MAX_LENGTH = 255

/** Largo máximo de la marca y del banco emisor. */
const CARD_FIELD_MAX_LENGTH = 50

/** Largo máximo del tipo de documento. */
const IDENTIFICATION_TYPE_MAX_LENGTH = 20

/** Si el documento del objeto es un DNI (el tipo ya llega recortado). */
function isDni(identification: unknown): boolean {
  const type = (identification as { type?: unknown } | null)?.type
  return typeof type === 'string' && type.trim() === DNI_TYPE
}

/**
 * Número de documento como lo deja `cardholderSchema`: a un DNI se le quitan los puntos y los
 * espacios; a otro tipo, los espacios de los bordes. Si no es texto, queda como vino.
 */
function toDocumentNumber({ obj, key }: TransformFnParams): unknown {
  const raw = (obj as Record<string, unknown>)[key]
  if (typeof raw !== 'string') return raw
  return isDni(obj) ? raw.replace(/[.\s]/g, '') : raw.trim()
}

/**
 * Valida el número según el tipo (Ruling B-51): DNI de 7 u 8 dígitos ("DNI inválido") u otro
 * documento de 5 a 20 letras o números ("Documento inválido"). La restricción se llama `matches`
 * para responder el mismo `code` que un patrón (`invalid_format`).
 */
function DocumentNumberRule(): PropertyDecorator {
  return ValidateBy({
    name: 'matches',
    validator: {
      validate: (value: unknown, args?: ValidationArguments) =>
        typeof value === 'string' &&
        (isDni(args?.object) ? DNI_PATTERN : DOCUMENT_PATTERN).test(value),
      defaultMessage: (args?: ValidationArguments) =>
        isDni(args?.object)
          ? CARD_PAYMENT_MESSAGES.invalidDni
          : CARD_PAYMENT_MESSAGES.invalidDocument,
    },
  })
}

/**
 * Documento de quien paga (`payer.identification`). Solo valida: el esquema de Swagger va en línea
 * en {@link CardPaymentInputDto.payer}, como en el contrato.
 */
export class IdentificationDto {
  /** Tipo según Mercado Pago (`DNI`, `CUIT`…), recortado. */
  @Trimmed()
  @MaxLength(IDENTIFICATION_TYPE_MAX_LENGTH, {
    message: maxMessage(IDENTIFICATION_TYPE_MAX_LENGTH),
  })
  @MinLength(1, { message: CARD_PAYMENT_MESSAGES.identificationType })
  @IsString({ message: CARD_PAYMENT_MESSAGES.identificationType })
  type!: string

  /** Número, sin puntos ni espacios si es un DNI y recortado si es otro tipo. */
  @Transform(toDocumentNumber)
  @DocumentNumberRule()
  number!: string
}

/** Quien paga (`payer`): email del pedido y documento. Solo valida (ver {@link IdentificationDto}). */
export class PayerDto {
  /** Email, recortado y en minúsculas. */
  @EmailField()
  email!: string

  /** Documento. */
  @IsDefined({ message: CARD_PAYMENT_MESSAGES.identification })
  @IsObject({ message: CARD_PAYMENT_MESSAGES.identification })
  @ValidateNested({ message: CARD_PAYMENT_MESSAGES.identification })
  @Type(() => IdentificationDto)
  identification!: IdentificationDto
}

/**
 * Datos para cobrar con tarjeta (`CardPaymentInput` del contrato): el token de MercadoPago.js y lo
 * que lo acompaña. El nombre del titular viaja dentro del token, nunca a esta API. Los mensajes de
 * cuotas y token son los mismos que responde la pasarela. Las restricciones de cada campo van de
 * abajo hacia arriba en el orden en que se revisan (la de abajo da el primer error).
 */
@ApiSchema({ name: 'CardPaymentInput' })
export class CardPaymentInputDto {
  /** Token de la tarjeta, de un solo uso. */
  @ApiSchemaProperty({ type: 'string', minLength: 1, maxLength: TOKEN_MAX_LENGTH })
  @RawValue()
  @MaxLength(TOKEN_MAX_LENGTH, { message: CARD_PAYMENT_MESSAGES.token })
  @MinLength(1, { message: CARD_PAYMENT_MESSAGES.token })
  @IsString({ message: CARD_PAYMENT_MESSAGES.token })
  token!: string

  /** Marca según Mercado Pago (`visa`, `master`…). */
  @ApiSchemaProperty({ type: 'string', minLength: 1, maxLength: CARD_FIELD_MAX_LENGTH })
  @RawValue()
  @MaxLength(CARD_FIELD_MAX_LENGTH, { message: CARD_PAYMENT_MESSAGES.paymentMethodId })
  @MinLength(1, { message: CARD_PAYMENT_MESSAGES.paymentMethodId })
  @IsString({ message: CARD_PAYMENT_MESSAGES.paymentMethodId })
  paymentMethodId!: string

  /** Banco emisor, o `null` si la tarjeta no lo necesita (obligatorio igual). */
  @ApiSchemaProperty({
    type: 'string',
    nullable: true,
    minLength: 1,
    maxLength: CARD_FIELD_MAX_LENGTH,
  })
  @RawValue()
  @ValidateIf((_object, value) => value !== null)
  @MaxLength(CARD_FIELD_MAX_LENGTH, { message: CARD_PAYMENT_MESSAGES.issuerId })
  @MinLength(1, { message: CARD_PAYMENT_MESSAGES.issuerId })
  @IsString({ message: CARD_PAYMENT_MESSAGES.issuerId })
  @IsDefined({ message: CARD_PAYMENT_MESSAGES.issuerId })
  issuerId!: string | null

  /** Cuotas elegidas, de 1 a 24. */
  @ApiSchemaProperty({ type: 'integer', minimum: 1, maximum: 24 })
  @RawValue()
  @Max(24, { message: CARD_PAYMENT_MESSAGES.installments })
  @Min(1, { message: CARD_PAYMENT_MESSAGES.installments })
  @IsInt({ message: CARD_PAYMENT_MESSAGES.installments })
  installments!: number

  /** Quien paga. */
  @ApiSchemaProperty({
    type: 'object',
    required: ['email', 'identification'],
    properties: {
      email: schemaRef('Email'),
      identification: {
        type: 'object',
        required: ['type', 'number'],
        properties: {
          type: { type: 'string', minLength: 1, maxLength: IDENTIFICATION_TYPE_MAX_LENGTH },
          number: { type: 'string', pattern: DOCUMENT_PATTERN.source },
        },
      },
    },
  })
  @IsDefined({ message: CARD_PAYMENT_MESSAGES.payer })
  @IsObject({ message: CARD_PAYMENT_MESSAGES.payer })
  @ValidateNested({ message: CARD_PAYMENT_MESSAGES.payer })
  @Type(() => PayerDto)
  payer!: PayerDto

  /**
   * El pago para `PayWithCardCommand`.
   *
   * @returns Token, marca, banco, cuotas y pagador como objetos planos.
   */
  toInput(): CardPaymentInput {
    return {
      token: this.token,
      paymentMethodId: this.paymentMethodId,
      issuerId: this.issuerId,
      installments: this.installments,
      payer: {
        email: this.payer.email,
        identification: {
          type: this.payer.identification.type,
          number: this.payer.identification.number,
        },
      },
    }
  }
}
