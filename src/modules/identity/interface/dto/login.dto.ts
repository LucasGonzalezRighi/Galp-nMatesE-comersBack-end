import { ApiSchema } from '@nestjs/swagger'

import type { Credentials } from '../../application/authentication'
import { CurrentPasswordField, EmailField } from './identity-fields'

/** Cuerpo de `POST /auth/login` (`LoginInput` del contrato). */
@ApiSchema({ name: 'LoginInput' })
export class LoginDto implements Credentials {
  /** Email, recortado y en minúsculas. */
  @EmailField()
  email!: string

  /** Contraseña de la cuenta (sin la regla de la contraseña nueva). */
  @CurrentPasswordField()
  password!: string
}
