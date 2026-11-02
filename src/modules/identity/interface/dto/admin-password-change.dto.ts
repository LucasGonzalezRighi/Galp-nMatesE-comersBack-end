import { ApiProperty, ApiSchema } from '@nestjs/swagger'
import { IsString, MaxLength } from 'class-validator'

import {
  CurrentPasswordField,
  IDENTITY_MESSAGES,
  maxMessage,
  NewPasswordField,
  PASSWORD_MAX_LENGTH,
  RawValue,
} from './identity-fields'

/**
 * Cuerpo de `POST /admin/auth/password` (`AdminPasswordChange` del contrato). Que `confirmation`
 * sea igual a `newPassword` lo revisa el controlador (422 en `confirmation`).
 */
@ApiSchema({ name: 'AdminPasswordChange' })
export class AdminPasswordChangeDto {
  /** Contraseña actual. */
  @CurrentPasswordField()
  currentPassword!: string

  /** Contraseña nueva. */
  @NewPasswordField()
  newPassword!: string

  /** Repetición de la contraseña nueva. */
  @ApiProperty({ type: 'string', maxLength: PASSWORD_MAX_LENGTH })
  @RawValue()
  @MaxLength(PASSWORD_MAX_LENGTH, { message: maxMessage(PASSWORD_MAX_LENGTH) })
  @IsString({ message: IDENTITY_MESSAGES.required })
  confirmation!: string
}
