import { ApiSchema } from '@nestjs/swagger'

import type { RegisterCustomerInput } from '../../application/commands/register-customer.command'
import { EmailField, NewPasswordField, PersonNameField } from './identity-fields'

/** Cuerpo de `POST /auth/register` (`RegisterInput` del contrato). */
@ApiSchema({ name: 'RegisterInput' })
export class RegisterDto implements RegisterCustomerInput {
  /** Email, recortado y en minúsculas. */
  @EmailField()
  email!: string

  /** Nombre, recortado. */
  @PersonNameField()
  firstName!: string

  /** Apellido, recortado. */
  @PersonNameField()
  lastName!: string

  /** Contraseña nueva. */
  @NewPasswordField()
  password!: string
}
