import { ApiProperty, ApiSchema } from '@nestjs/swagger'
import { IsIn, Matches } from 'class-validator'

import { RawValue } from '../../../identity/interface/dto/identity-fields'

/** Tipos de tarjeta que acepta la consulta de cuotas. */
export const INSTALLMENT_CARD_TYPES = ['credit_card', 'debit_card'] as const

/** Textos de error de la consulta de cuotas. */
export const INSTALLMENTS_INPUT_MESSAGES = {
  /** BIN que no tiene de 6 a 8 dígitos (el del mock del front). */
  bin: 'Ingresá los primeros 6 a 8 dígitos de la tarjeta.',
  /** Tipo de tarjeta que no es crédito ni débito. */
  paymentTypeId: 'Elegí si la tarjeta es de crédito o de débito.',
} as const

/**
 * Tarjeta para la que se consultan las cuotas (`InstallmentsInput` del contrato): solo los
 * primeros dígitos, que no alcanzan para usarla, y el tipo.
 */
@ApiSchema({ name: 'InstallmentsInput' })
export class InstallmentsInputDto {
  /** Primeros 6 a 8 dígitos del número de la tarjeta. */
  @ApiProperty({ type: 'string', pattern: '^[0-9]{6,8}$' })
  @RawValue()
  @Matches(/^[0-9]{6,8}$/, { message: INSTALLMENTS_INPUT_MESSAGES.bin })
  bin!: string

  /** Crédito o débito (con débito hay una sola opción, de 1 pago). */
  @ApiProperty({ type: 'string', enum: [...INSTALLMENT_CARD_TYPES] })
  @RawValue()
  @IsIn(INSTALLMENT_CARD_TYPES, { message: INSTALLMENTS_INPUT_MESSAGES.paymentTypeId })
  paymentTypeId!: (typeof INSTALLMENT_CARD_TYPES)[number]

  /**
   * La consulta para `GetInstallmentsQuery`.
   *
   * @returns BIN y tipo de tarjeta.
   */
  toInput(): { bin: string; paymentTypeId: (typeof INSTALLMENT_CARD_TYPES)[number] } {
    return { bin: this.bin, paymentTypeId: this.paymentTypeId }
  }
}
