import { beforeEach, describe, expect, it, vi } from 'vitest'

import { FixedSecrets, InMemorySessionStore } from '../../../../../test/support/session'
import {
  FakeHasher,
  FixedClock,
  InMemoryCustomerRepository,
  InMemoryLoginAttempts,
  InMemoryUserRepository,
  RecordingMailer,
} from '../../../../../test/support/identity'
import { LoginLockedError, StaleSessionError } from '../../domain/identity-errors'
import type { AccountDeletionRepository, AccountToDelete } from '../ports/account-deletion.port'
import { DeleteAccountCommand } from './delete-account.command'

const PASSWORD = 'mate-con-yerba-2026'
const IP = '203.0.113.7'

/** Baja en memoria: borra el usuario y el cliente de los repositorios de prueba. */
class InMemoryAccountDeletion implements AccountDeletionRepository {
  readonly deleted: AccountToDelete[] = []

  constructor(
    private readonly users: InMemoryUserRepository,
    private readonly customers: InMemoryCustomerRepository,
  ) {}

  deleteAccount(account: AccountToDelete): Promise<void> {
    this.deleted.push({ ...account })
    this.users.users.delete(account.userId)
    this.customers.customers.delete(account.customerId)
    return Promise.resolve()
  }
}

describe('DeleteAccountCommand', () => {
  let clock: FixedClock
  let sessions: InMemorySessionStore
  let users: InMemoryUserRepository
  let customers: InMemoryCustomerRepository
  let accounts: InMemoryAccountDeletion
  let mailer: RecordingMailer
  let command: DeleteAccountCommand

  beforeEach(() => {
    clock = new FixedClock()
    sessions = new InMemorySessionStore(clock, new FixedSecrets())
    users = new InMemoryUserRepository()
    customers = new InMemoryCustomerRepository(users)
    accounts = new InMemoryAccountDeletion(users, customers)
    mailer = new RecordingMailer()
    command = new DeleteAccountCommand(
      users,
      customers,
      accounts,
      new FakeHasher(),
      new InMemoryLoginAttempts(clock),
      sessions,
      mailer,
    )
    users.users.set('usr-1', {
      id: 'usr-1',
      email: 'ana@mail.com',
      passwordHash: `hashed:${PASSWORD}`,
      role: 'customer',
      status: 'active',
      emailVerifiedAt: null,
      lastLoginAt: null,
    })
    customers.customers.set('cus-1', {
      id: 'cus-1',
      userId: 'usr-1',
      email: 'ana@mail.com',
      firstName: 'Ana',
      lastName: 'Pérez',
      phone: null,
    })
  })

  it('con la contraseña equivocada no cambia nada', async () => {
    const result = await command.execute('usr-1', { password: 'otra-cosa' }, { clientIp: IP })

    expect(result).toEqual({ ok: false, error: 'wrong_password' })
    expect(accounts.deleted).toEqual([])
    expect(mailer.accountDeletions).toEqual([])
    expect(users.users.has('usr-1')).toBe(true)
  })

  it('con la contraseña correcta borra la cuenta, cierra todas las sesiones y avisa por mail', async () => {
    const first = await sessions.create({ kind: 'customer', userId: 'usr-1', customerId: 'cus-1' })
    const second = await sessions.create({ kind: 'customer', userId: 'usr-1', customerId: 'cus-1' })

    const result = await command.execute('usr-1', { password: PASSWORD }, { clientIp: IP })

    expect(result.ok).toBe(true)
    expect(accounts.deleted).toEqual([{ userId: 'usr-1', customerId: 'cus-1' }])
    expect(await sessions.get(first.id)).toBeNull()
    expect(await sessions.get(second.id)).toBeNull()
    expect(mailer.accountDeletions).toEqual([{ to: 'ana@mail.com', firstName: 'Ana' }])
  })

  it('si el almacén de sesiones falla después de borrar la cuenta, el aviso por mail ya salió', async () => {
    vi.spyOn(sessions, 'destroyAllForUser').mockRejectedValue(new Error('Redis no responde'))

    await expect(
      command.execute('usr-1', { password: PASSWORD }, { clientIp: IP }),
    ).rejects.toThrow('Redis no responde')

    expect(accounts.deleted).toEqual([{ userId: 'usr-1', customerId: 'cus-1' }])
    expect(mailer.accountDeletions).toEqual([{ to: 'ana@mail.com', firstName: 'Ana' }])
  })

  it('diez contraseñas equivocadas bloquean como el inicio de sesión', async () => {
    for (let attempt = 1; attempt < 10; attempt += 1) {
      await expect(
        command.execute('usr-1', { password: 'otra-cosa' }, { clientIp: IP }),
      ).resolves.toEqual({ ok: false, error: 'wrong_password' })
    }
    await expect(
      command.execute('usr-1', { password: 'otra-cosa' }, { clientIp: IP }),
    ).rejects.toBeInstanceOf(LoginLockedError)
    await expect(
      command.execute('usr-1', { password: PASSWORD }, { clientIp: IP }),
    ).rejects.toBeInstanceOf(LoginLockedError)
    expect(accounts.deleted).toEqual([])
  })

  it('una sesión de un usuario que ya no existe responde 401', async () => {
    await expect(
      command.execute('usr-9', { password: PASSWORD }, { clientIp: IP }),
    ).rejects.toBeInstanceOf(StaleSessionError)
  })
})
