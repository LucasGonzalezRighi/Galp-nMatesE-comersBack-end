import { ApiSchema } from '@nestjs/swagger'

import type { Credentials } from '../../application/authentication'
import { CurrentPasswordField, EmailField } from './identity-fields'

/** Cuerpo de `POST /admin/auth/login` (`AdminLoginInput` del contrato). */
@ApiSchema({ name: 'AdminLoginInput' })
export class AdminLoginDto implements Credentials {
  /** Email del administrador, recortado y en minúsculas. */
  @EmailField()
  email!: string

  /** Contraseña del administrador. */
  @CurrentPasswordField()
  password!: string
}
