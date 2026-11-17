import { ApiSchema } from '@nestjs/swagger'

import type { DeleteAccountInput } from '../../application/commands/delete-account.command'
import { CurrentPasswordField } from './identity-fields'

/** Cuerpo de `DELETE /me` (`AccountDeletion` del contrato, `deleteAccountSchema` del front). */
@ApiSchema({ name: 'AccountDeletion' })
export class AccountDeletionDto implements DeleteAccountInput {
  /** Contraseña actual del cliente, de 1 a 128 caracteres. */
  @CurrentPasswordField()
  password!: string
}
