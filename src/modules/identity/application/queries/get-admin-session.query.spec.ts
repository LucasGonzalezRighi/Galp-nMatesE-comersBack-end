import { beforeEach, describe, expect, it } from 'vitest'

import { InMemoryUserRepository } from '../../../../../test/support/identity'
import type { SessionRecord } from '../../../../shared/application/ports/session.port'
import { StaleSessionError } from '../../domain/identity-errors'
import { GetAdminSessionQuery } from './get-admin-session.query'

/** Sesión de admin de prueba. */
function adminSession(userId: string): SessionRecord {
  return {
    id: 'a'.repeat(64),
    kind: 'admin',
    userId,
    customerId: null,
    csrfToken: 'b'.repeat(64),
    createdAt: '2026-11-02T12:00:00.000Z',
    authenticatedAt: '2026-11-02T12:00:00.000Z',
    expiresAt: '2026-11-02T20:00:00.000Z',
  }
}

describe('GetAdminSessionQuery', () => {
  let users: InMemoryUserRepository
  let query: GetAdminSessionQuery

  beforeEach(async () => {
    users = new InMemoryUserRepository()
    query = new GetAdminSessionQuery(users)
    await users.create({
      id: 'admin-1',
      email: 'admin@galponmates.com.ar',
      passwordHash: 'x',
      role: 'admin',
      status: 'active',
    })
    await users.create({
      id: 'user-1',
      email: 'ana@mail.com',
      passwordHash: 'x',
      role: 'customer',
      status: 'active',
    })
  })

  it('devuelve el email del admin y el vencimiento de la sesión', async () => {
    await expect(query.execute(adminSession('admin-1'))).resolves.toEqual({
      email: 'admin@galponmates.com.ar',
      expiresAt: '2026-11-02T20:00:00.000Z',
    })
  })

  it('una sesión cuyo usuario ya no existe, no es admin o está deshabilitado → 401', async () => {
    await users.create({
      id: 'admin-2',
      email: 'baja@galponmates.com.ar',
      passwordHash: 'x',
      role: 'admin',
      status: 'disabled',
    })

    for (const userId of ['nadie', 'user-1', 'admin-2']) {
      await expect(query.execute(adminSession(userId))).rejects.toBeInstanceOf(StaleSessionError)
    }
  })

  it('rechaza una sesión que no es de admin (error de programación)', async () => {
    const customer: SessionRecord = {
      ...adminSession('user-1'),
      kind: 'customer',
      customerId: 'c-1',
    }

    await expect(query.execute(customer)).rejects.toThrow(TypeError)
  })
})
