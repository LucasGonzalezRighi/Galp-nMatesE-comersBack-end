import { ApiProperty, ApiSchema } from '@nestjs/swagger'
import { IsNotEmpty, IsString, MaxLength } from 'class-validator'

import type { ResetPasswordInput } from '../../application/commands/reset-password.command'
import { IDENTITY_MESSAGES, maxMessage, NewPasswordField, Trimmed } from './identity-fields'

/** Largo máximo del token del enlace (`ResetPasswordInput.token`). */
const TOKEN_MAX_LENGTH = 255

/** Cuerpo de `POST /auth/password/reset` (`ResetPasswordInput` del contrato). */
@ApiSchema({ name: 'ResetPasswordInput' })
export class ResetPasswordDto implements ResetPasswordInput {
  /** Token del enlace del mail (`rt_…`), recortado. */
  @ApiProperty({ type: 'string', minLength: 1, maxLength: TOKEN_MAX_LENGTH })
  @Trimmed()
  // class-validator corre los decoradores de abajo hacia arriba: el tipo va primero.
  @MaxLength(TOKEN_MAX_LENGTH, { message: maxMessage(TOKEN_MAX_LENGTH) })
  @IsNotEmpty({ message: IDENTITY_MESSAGES.required })
  @IsString({ message: IDENTITY_MESSAGES.required })
  token!: string

  /** Contraseña nueva. */
  @NewPasswordField()
  password!: string
}
