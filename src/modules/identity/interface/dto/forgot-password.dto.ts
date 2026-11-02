import { ApiSchema } from '@nestjs/swagger'

import { EmailField } from './identity-fields'

/** Cuerpo de `POST /auth/password/forgot` (`ForgotPasswordInput` del contrato). */
@ApiSchema({ name: 'ForgotPasswordInput' })
export class ForgotPasswordDto {
  /** Email de la cuenta, recortado y en minúsculas. */
  @EmailField()
  email!: string
}
