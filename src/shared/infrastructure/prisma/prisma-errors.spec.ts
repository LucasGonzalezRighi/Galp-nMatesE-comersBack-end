import { describe, expect, it } from 'vitest'

import { Prisma } from '../../../generated/prisma/client'
import { isUniqueViolation } from './prisma-errors'

/** Error conocido de Prisma con el código pedido. */
function prismaError(code: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Falló la consulta', {
    code,
    clientVersion: '7.10.1',
  })
}

describe('isUniqueViolation', () => {
  it('reconoce el P2002 de Prisma', () => {
    expect(isUniqueViolation(prismaError('P2002'))).toBe(true)
  })

  it('no confunde otro código de Prisma con una unicidad', () => {
    expect(isUniqueViolation(prismaError('P2025'))).toBe(false)
    expect(isUniqueViolation(prismaError('P2003'))).toBe(false)
  })

  it('un error cualquiera (o algo que no es un error) da false', () => {
    expect(isUniqueViolation(new Error('P2002'))).toBe(false)
    expect(isUniqueViolation({ code: 'P2002' })).toBe(false)
    expect(isUniqueViolation(undefined)).toBe(false)
  })
})
