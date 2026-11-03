import { Prisma } from '../../../generated/prisma/client'

/**
 * Indica si un error de Prisma es una violación de unicidad (`P2002`): un `INSERT` o un `UPDATE`
 * chocó con un índice único (por ejemplo, dos pedidos que crean a la vez el invitado del mismo
 * email). Cualquier otro error, de Prisma o no, da `false`.
 *
 * @param error - Lo que se atrapó.
 */
export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}
