import { Injectable } from '@nestjs/common'

import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service'
import type {
  AccountDeletionRepository,
  AccountToDelete,
} from '../application/ports/account-deletion.port'

/**
 * Baja de una cuenta con Prisma, en una transacción (LS-5; la tabla por tabla está en
 * `docs/adr/0008-datos-personales.md`):
 *
 * - `orders` (y con ellos pagos, envíos y líneas): quedan, sin vínculo (`customer_id = null`), con
 *   los datos del comprobante, por los 10 años de conservación.
 * - `reviews`: las pendientes (nadie las publicó) se borran; las aprobadas u ocultas quedan sin
 *   vínculo y la purga diaria sigue con sus plazos.
 * - `addresses`: se borran. `customers`: se borra la fila del cliente de la cuenta.
 * - `password_reset_tokens`: se borran. `users`: se borra la fila (el email queda libre y una
 *   cuenta nueva con ese email arranca sin nada).
 *
 * El invitado del mismo email, los mensajes de contacto y las solicitudes de arrepentimiento no
 * tienen vínculo con la cuenta: no se tocan (siguen sus propios plazos). Toca tablas de `orders` y
 * `reviews` porque la baja es por definición transversal; solo saca vínculos o borra lo que es de
 * esta cuenta.
 */
@Injectable()
export class PrismaAccountDeletionRepository implements AccountDeletionRepository {
  /** @param prisma - Cliente de Prisma de la app. */
  constructor(private readonly prisma: PrismaService) {}

  /** {@inheritDoc AccountDeletionRepository.deleteAccount} */
  async deleteAccount({ userId, customerId }: AccountToDelete): Promise<void> {
    if (userId.trim() === '' || customerId.trim() === '') {
      throw new TypeError('Para eliminar una cuenta hacen falta el usuario y el cliente')
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.order.updateMany({ where: { customerId }, data: { customerId: null } })
      await tx.review.deleteMany({ where: { customerId, status: 'pending' } })
      await tx.review.updateMany({ where: { customerId }, data: { customerId: null } })
      await tx.address.deleteMany({ where: { customerId } })
      await tx.customer.deleteMany({ where: { id: customerId, userId } })
      await tx.passwordResetToken.deleteMany({ where: { userId } })
      await tx.user.deleteMany({ where: { id: userId, role: 'customer' } })
    })
  }
}
