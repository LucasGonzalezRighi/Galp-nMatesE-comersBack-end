import { beforeEach, describe, expect, it, vi } from 'vitest'

import { err, ok } from '../../../shared/domain/result'
import { FixedSecrets, InMemorySessionStore } from '../../../../test/support/session'
import {
  FakeHasher,
  FixedClock,
  InMemoryAddressRepository,
  InMemoryCustomerRepository,
  InMemoryLoginAttempts,
  InMemoryPasswordResetRepository,
  InMemoryUserRepository,
  RecordingMailer,
} from '../../../../test/support/identity'
import type { AddressInput } from '../domain/address.entity'
import {
  AddressNotFoundError,
  EmailAlreadyRegisteredError,
  InvalidCredentialsError,
  LoginLockedError,
} from '../domain/identity-errors'
import type { User } from '../domain/user.entity'
import { AdminLoginCommand } from './commands/admin-login.command'
import { ChangeAdminPasswordCommand } from './commands/change-admin-password.command'
import { CreateMyAddressCommand } from './commands/create-my-address.command'
import { DeleteMyAddressCommand } from './commands/delete-my-address.command'
import { IssueCsrfTokenCommand } from './commands/issue-csrf-token.command'
import { LoginCustomerCommand } from './commands/login-customer.command'
import { LogoutCommand } from './commands/logout.command'
import { RegisterCustomerCommand } from './commands/register-customer.command'
import { RequestPasswordResetCommand } from './commands/request-password-reset.command'
import { ResetPasswordCommand } from './commands/reset-password.command'
import { UpdateMeCommand } from './commands/update-me.command'
import { UpdateMyAddressCommand } from './commands/update-my-address.command'
import { GetMeQuery } from './queries/get-me.query'
import { ListMyAddressesQuery } from './queries/list-my-addresses.query'

const STORE_ORIGIN = 'http://localhost:3000'
const PASSWORD = 'mate-con-yerba-2026'

/** IP del cliente que inicia sesión (el bloqueo cuenta por email y por IP). */
const IP = '203.0.113.7'

/** Puertos en memoria compartidos por los casos de uso de cada test. */
function setup() {
  const clock = new FixedClock()
  const secrets = new FixedSecrets()
  const sessions = new InMemorySessionStore(clock, secrets)
  const users = new InMemoryUserRepository()
  const customers = new InMemoryCustomerRepository(users)
  const addresses = new InMemoryAddressRepository()
  const resets = new InMemoryPasswordResetRepository()
  const hasher = new FakeHasher()
  const mailer = new RecordingMailer()
  const attempts = new InMemoryLoginAttempts(clock)
  return { clock, secrets, sessions, users, customers, addresses, resets, hasher, mailer, attempts }
}

type Deps = ReturnType<typeof setup>

/** Siembra un usuario directamente en el repositorio. */
function seedUser(deps: Deps, overrides: Partial<User> = {}): User {
  const user: User = {
    id: `usr-${String(deps.users.users.size + 1)}`,
    email: 'ana@mail.com',
    passwordHash: `hashed:${PASSWORD}`,
    role: 'customer',
    status: 'active',
    emailVerifiedAt: null,
    lastLoginAt: null,
    ...overrides,
  }
  deps.users.users.set(user.id, user)
  return user
}

/** Dirección de la libreta con lo mínimo. */
function addressInput(overrides: Partial<AddressInput> = {}): AddressInput {
  return {
    label: 'Casa',
    street: 'Av. Corrientes',
    number: '1234',
    apartment: null,
    postalCode: 'C1414',
    city: 'CABA',
    province: 'CABA',
    isDefault: false,
    ...overrides,
  }
}

describe('RegisterCustomerCommand', () => {
  let deps: Deps
  let register: RegisterCustomerCommand

  beforeEach(() => {
    deps = setup()
    register = new RegisterCustomerCommand(deps.users, deps.customers, deps.hasher, deps.sessions)
  })

  it('crea usuario y cliente y abre una sesión de cliente destruyendo la anónima', async () => {
    const anonymous = await deps.sessions.create({
      kind: 'anonymous',
      userId: null,
      customerId: null,
    })

    const result = await register.execute(
      { email: ' Ana@Mail.com ', firstName: ' Ana ', lastName: 'Pérez', password: PASSWORD },
      anonymous.id,
    )

    expect(result.customer).toEqual({
      email: 'ana@mail.com',
      firstName: 'Ana',
      lastName: 'Pérez',
      phone: null,
    })
    const [user] = [...deps.users.users.values()]
    expect(user).toMatchObject({
      email: 'ana@mail.com',
      passwordHash: `hashed:${PASSWORD}`,
      role: 'customer',
      status: 'active',
    })
    const [customer] = [...deps.customers.customers.values()]
    expect(customer?.userId).toBe(user?.id)
    expect(result.session).toMatchObject({
      kind: 'customer',
      userId: user?.id,
      customerId: customer?.id,
    })
    expect(await deps.sessions.get(anonymous.id)).toBeNull()
    expect(await deps.sessions.get(result.session.id)).not.toBeNull()
  })

  it('con el email de un invitado crea un cliente nuevo: no adopta sus datos ni sus pedidos (NV-02)', async () => {
    const guest = {
      id: 'cus-guest',
      userId: null,
      email: 'ana@mail.com',
      firstName: 'Anita',
      lastName: 'P',
      phone: '1123456789',
    }
    deps.customers.customers.set(guest.id, { ...guest })

    const result = await register.execute(
      { email: 'ANA@mail.com', firstName: 'Ana', lastName: 'Pérez', password: PASSWORD },
      null,
    )

    expect(deps.customers.customers.size).toBe(2)
    expect(deps.customers.customers.get(guest.id)).toEqual(guest)
    const [user] = [...deps.users.users.values()]
    const account = await deps.customers.findByUserId(user?.id ?? '')
    expect(account).toMatchObject({ email: 'ana@mail.com', firstName: 'Ana', phone: null })
    expect(account?.id).not.toBe(guest.id)
    expect(result.customer.phone).toBeNull()
    expect(result.session.customerId).toBe(account?.id)
  })

  it('rechaza un email ya registrado aunque cambien las mayúsculas', async () => {
    await register.execute(
      { email: ' Ana@Mail.com ', firstName: 'Ana', lastName: 'Pérez', password: PASSWORD },
      null,
    )

    await expect(
      register.execute(
        { email: 'ANA@mail.com', firstName: 'Ana', lastName: 'Pérez', password: PASSWORD },
        null,
      ),
    ).rejects.toBeInstanceOf(EmailAlreadyRegisteredError)
    expect(deps.users.users.size).toBe(1)
  })
})

describe('LoginCustomerCommand', () => {
  let deps: Deps
  let login: LoginCustomerCommand
  let user: User

  beforeEach(() => {
    deps = setup()
    login = new LoginCustomerCommand(
      deps.users,
      deps.customers,
      deps.hasher,
      deps.attempts,
      deps.sessions,
      deps.clock,
    )
    user = seedUser(deps)
    deps.customers.customers.set('cus-1', {
      id: 'cus-1',
      userId: user.id,
      email: user.email,
      firstName: 'Ana',
      lastName: 'Pérez',
      phone: null,
    })
  })

  it('con la contraseña mala responde credenciales incorrectas y el décimo fallo bloquea', async () => {
    for (let attempt = 1; attempt < 10; attempt += 1) {
      await expect(
        login.execute({ email: 'ana@mail.com', password: 'otra-cosa-1', clientIp: IP }, null),
      ).rejects.toBeInstanceOf(InvalidCredentialsError)
    }

    const tenth = login.execute(
      { email: 'ana@mail.com', password: 'otra-cosa-1', clientIp: IP },
      null,
    )

    await expect(tenth).rejects.toBeInstanceOf(LoginLockedError)
    const error = await tenth.catch((caught: unknown) => caught)
    expect(error instanceof LoginLockedError && error.retryAfterSeconds).toBeGreaterThan(0)
    // Bloqueado, ni la contraseña correcta entra hasta que termina la ventana.
    await expect(
      login.execute({ email: 'ana@mail.com', password: PASSWORD, clientIp: IP }, null),
    ).rejects.toBeInstanceOf(LoginLockedError)
    deps.clock.advance(15 * 60 * 1000)
    await expect(
      login.execute({ email: 'ana@mail.com', password: PASSWORD, clientIp: IP }, null),
    ).resolves.toMatchObject({ customer: { email: 'ana@mail.com' } })
  })

  it('al entrar limpia los fallos, actualiza lastLoginAt y rota la sesión', async () => {
    await expect(
      login.execute({ email: 'ana@mail.com', password: 'mala-1234567', clientIp: IP }, null),
    ).rejects.toBeInstanceOf(InvalidCredentialsError)
    const anonymous = await deps.sessions.create({
      kind: 'anonymous',
      userId: null,
      customerId: null,
    })

    const result = await login.execute(
      { email: ' ANA@mail.com ', password: PASSWORD, clientIp: IP },
      anonymous.id,
    )

    expect(result.customer).toEqual({
      email: 'ana@mail.com',
      firstName: 'Ana',
      lastName: 'Pérez',
      phone: null,
    })
    expect(deps.attempts.count('ana@mail.com', IP)).toBe(0)
    expect(deps.users.users.get(user.id)?.lastLoginAt).toEqual(deps.clock.now())
    expect(result.session).toMatchObject({ kind: 'customer', userId: user.id, customerId: 'cus-1' })
    expect(await deps.sessions.get(anonymous.id)).toBeNull()
  })

  it('una sesión abierta con la contraseña vieja mientras corre un restablecimiento queda rechazada (NV-03)', async () => {
    const readUser = deps.users.findByEmail.bind(deps.users)
    vi.spyOn(deps.users, 'findByEmail').mockImplementationOnce(async (email) => {
      const found = await readUser(email)
      // Con el hash viejo ya leído, el restablecimiento cambia la contraseña y cierra todo.
      deps.clock.advance(5)
      await deps.users.updatePassword(user.id, 'hashed:nueva-clave-2027')
      await deps.sessions.destroyAllForUser(user.id)
      deps.clock.advance(5)
      return found
    })

    const result = await login.execute(
      { email: 'ana@mail.com', password: PASSWORD, clientIp: IP },
      null,
    )

    expect(await deps.sessions.get(result.session.id)).toBeNull()
  })

  it('intentos a la vez no pasan el tope: el contador sube antes de verificar (NV-08)', async () => {
    const outcomes = await Promise.all(
      Array.from({ length: 15 }, () =>
        login
          .execute({ email: 'ana@mail.com', password: 'otra-cosa-1', clientIp: IP }, null)
          .catch((caught: unknown) => caught),
      ),
    )

    expect(deps.hasher.verifyCalls).toBe(10)
    expect(outcomes.filter((outcome) => outcome instanceof InvalidCredentialsError)).toHaveLength(9)
    expect(outcomes.filter((outcome) => outcome instanceof LoginLockedError)).toHaveLength(6)
  })

  it('el bloqueo cuenta por email y por IP: los fallos desde otra IP no bloquean al dueño (NV-09)', async () => {
    const attacker = '198.51.100.23'
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      await login
        .execute({ email: 'ana@mail.com', password: 'otra-cosa-1', clientIp: attacker }, null)
        .catch(() => undefined)
    }

    await expect(
      login.execute({ email: 'ana@mail.com', password: PASSWORD, clientIp: attacker }, null),
    ).rejects.toBeInstanceOf(LoginLockedError)
    await expect(
      login.execute({ email: 'ana@mail.com', password: PASSWORD, clientIp: IP }, null),
    ).resolves.toMatchObject({ customer: { email: 'ana@mail.com' } })
  })

  it('un admin no entra por la ruta del cliente', async () => {
    seedUser(deps, { id: 'usr-admin', email: 'admin@galponmates.com.ar', role: 'admin' })

    await expect(
      login.execute({ email: 'admin@galponmates.com.ar', password: PASSWORD, clientIp: IP }, null),
    ).rejects.toBeInstanceOf(InvalidCredentialsError)
  })

  it('un email desconocido o una cuenta deshabilitada no se distinguen de una contraseña mala', async () => {
    seedUser(deps, { id: 'usr-off', email: 'off@mail.com', status: 'disabled' })

    await expect(
      login.execute({ email: 'nadie@mail.com', password: PASSWORD, clientIp: IP }, null),
    ).rejects.toBeInstanceOf(InvalidCredentialsError)
    // Igual verifica contra un hash fijo, para no responder más rápido.
    expect(deps.hasher.verifyCalls).toBe(1)
    await expect(
      login.execute({ email: 'off@mail.com', password: PASSWORD, clientIp: IP }, null),
    ).rejects.toBeInstanceOf(InvalidCredentialsError)
    expect(deps.attempts.count('nadie@mail.com', IP)).toBe(1)
    expect(deps.attempts.count('off@mail.com', IP)).toBe(1)
  })
})

describe('LogoutCommand', () => {
  it('cierra la sesión', async () => {
    const deps = setup()
    const session = await deps.sessions.create({
      kind: 'customer',
      userId: 'usr-1',
      customerId: 'cus-1',
    })

    await new LogoutCommand(deps.sessions).execute(session.id)

    expect(await deps.sessions.get(session.id)).toBeNull()
  })
})

describe('recuperación de contraseña', () => {
  let deps: Deps
  let request: RequestPasswordResetCommand
  let reset: ResetPasswordCommand
  let user: User

  beforeEach(() => {
    deps = setup()
    request = new RequestPasswordResetCommand(
      deps.users,
      deps.customers,
      deps.resets,
      deps.mailer,
      deps.secrets,
      deps.clock,
      STORE_ORIGIN,
    )
    reset = new ResetPasswordCommand(
      deps.resets,
      deps.users,
      deps.hasher,
      deps.sessions,
      deps.secrets,
      deps.clock,
    )
    user = seedUser(deps)
    deps.customers.customers.set('cus-1', {
      id: 'cus-1',
      userId: user.id,
      email: user.email,
      firstName: 'Ana',
      lastName: 'Pérez',
      phone: null,
    })
  })

  /** Pide el cambio y devuelve el token del link que se mandó. */
  async function requestToken(): Promise<string> {
    await request.execute('Ana@Mail.com')
    const link = deps.mailer.passwordResets.at(-1)?.link ?? ''
    return new URL(link).searchParams.get('token') ?? ''
  }

  it('con un email desconocido no manda nada y resuelve igual', async () => {
    await expect(request.execute('nadie@mail.com')).resolves.toBeUndefined()

    expect(deps.mailer.passwordResets).toEqual([])
    expect(deps.resets.tokens).toEqual([])
  })

  it('con un email conocido manda el link y guarda solo el SHA-256 del token', async () => {
    await request.execute(' Ana@Mail.com ')

    expect(deps.mailer.passwordResets).toHaveLength(1)
    const mail = deps.mailer.passwordResets[0]
    expect(mail?.to).toBe('ana@mail.com')
    expect(mail?.firstName).toBe('Ana')
    expect(mail?.link).toMatch(
      /^http:\/\/localhost:3000\/cuenta\/restablecer\?token=rt_[0-9a-f]{64}$/,
    )
    const token = new URL(mail?.link ?? '').searchParams.get('token') ?? ''
    expect(deps.resets.tokens).toEqual([
      {
        userId: user.id,
        tokenHash: deps.secrets.sha256(token),
        expiresAt: new Date(deps.clock.now().getTime() + 60 * 60 * 1000),
        usedAt: null,
      },
    ])
    expect(JSON.stringify(deps.resets.tokens)).not.toContain(token)
  })

  it('el token cambia la contraseña, cierra todas las sesiones y sirve una sola vez', async () => {
    const first = await deps.sessions.create({
      kind: 'customer',
      userId: user.id,
      customerId: 'cus-1',
    })
    const second = await deps.sessions.create({
      kind: 'customer',
      userId: user.id,
      customerId: 'cus-1',
    })
    const token = await requestToken()

    await expect(reset.execute({ token, password: 'nueva-clave-2027' })).resolves.toEqual(
      ok(undefined),
    )

    expect(deps.users.users.get(user.id)?.passwordHash).toBe('hashed:nueva-clave-2027')
    expect(await deps.sessions.get(first.id)).toBeNull()
    expect(await deps.sessions.get(second.id)).toBeNull()
    await expect(reset.execute({ token, password: 'otra-clave-2028' })).resolves.toEqual(
      err('invalid_token'),
    )
  })

  it('un token vencido no sirve', async () => {
    const token = await requestToken()
    deps.clock.advance(61 * 60 * 1000)

    await expect(reset.execute({ token, password: 'nueva-clave-2027' })).resolves.toEqual(
      err('invalid_token'),
    )
    expect(deps.users.users.get(user.id)?.passwordHash).toBe(`hashed:${PASSWORD}`)
  })
})

describe('datos del cliente', () => {
  it('GetMeQuery devuelve los datos y UpdateMeCommand cambia solo lo que viene', async () => {
    const deps = setup()
    deps.customers.customers.set('cus-1', {
      id: 'cus-1',
      userId: 'usr-1',
      email: 'ana@mail.com',
      firstName: 'Ana',
      lastName: 'Pérez',
      phone: '1123456789',
    })
    const session = await deps.sessions.create({
      kind: 'customer',
      userId: 'usr-1',
      customerId: 'cus-1',
    })

    await expect(new GetMeQuery(deps.customers).execute(session)).resolves.toEqual({
      email: 'ana@mail.com',
      firstName: 'Ana',
      lastName: 'Pérez',
      phone: '1123456789',
    })
    await expect(
      new UpdateMeCommand(deps.customers).execute('cus-1', { firstName: ' Anabel ', phone: null }),
    ).resolves.toEqual({
      email: 'ana@mail.com',
      firstName: 'Anabel',
      lastName: 'Pérez',
      phone: null,
    })
  })
})

describe('libreta de direcciones', () => {
  let deps: Deps

  beforeEach(() => {
    deps = setup()
  })

  it('una sola predeterminada, que se lista primero', async () => {
    const create = new CreateMyAddressCommand(deps.addresses)
    const list = new ListMyAddressesQuery(deps.addresses)

    const home = await create.execute('cus-1', addressInput({ isDefault: true }))
    await create.execute('cus-1', addressInput({ label: 'Club', isDefault: false }))
    const work = await create.execute(
      'cus-1',
      addressInput({ label: 'Trabajo', postalCode: 'b1900', number: 's/n', isDefault: true }),
    )

    const book = await list.execute('cus-1')
    expect(book.map(({ label, isDefault }) => [label, isDefault])).toEqual([
      ['Trabajo', true],
      ['Casa', false],
      ['Club', false],
    ])
    expect(book[0]).toEqual({ ...work, postalCode: 'B1900', number: 'S/N' })
    expect(home.id).not.toBe(work.id)
  })

  it('no deja tocar ni borrar la dirección de otro cliente', async () => {
    const mine = await new CreateMyAddressCommand(deps.addresses).execute('cus-1', addressInput())
    const update = new UpdateMyAddressCommand(deps.addresses)
    const remove = new DeleteMyAddressCommand(deps.addresses)

    await expect(update.execute('cus-2', mine.id, addressInput())).rejects.toBeInstanceOf(
      AddressNotFoundError,
    )
    await expect(remove.execute('cus-2', mine.id)).rejects.toBeInstanceOf(AddressNotFoundError)
    await expect(remove.execute('cus-1', 'adr-0001')).rejects.toBeInstanceOf(AddressNotFoundError)

    await expect(
      update.execute('cus-1', mine.id, addressInput({ city: 'Rosario', province: 'Santa Fe' })),
    ).resolves.toMatchObject({ id: mine.id, city: 'Rosario', province: 'Santa Fe' })
    await remove.execute('cus-1', mine.id)
    expect(await new ListMyAddressesQuery(deps.addresses).execute('cus-1')).toEqual([])
  })
})

describe('admin', () => {
  let deps: Deps
  let admin: User

  beforeEach(() => {
    deps = setup()
    admin = seedUser(deps, { id: 'usr-admin', email: 'admin@galponmates.com.ar', role: 'admin' })
  })

  it('AdminLoginCommand abre una sesión de admin y rechaza a un cliente', async () => {
    seedUser(deps, { id: 'usr-cus', email: 'ana@mail.com' })
    const login = new AdminLoginCommand(
      deps.users,
      deps.hasher,
      deps.attempts,
      deps.sessions,
      deps.clock,
    )

    const result = await login.execute({
      email: 'Admin@GalponMates.com.ar',
      password: PASSWORD,
      clientIp: IP,
    })

    expect(result.email).toBe('admin@galponmates.com.ar')
    expect(result.session).toMatchObject({ kind: 'admin', userId: admin.id, customerId: null })
    await expect(
      login.execute({ email: 'ana@mail.com', password: PASSWORD, clientIp: IP }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError)
  })

  it('ChangeAdminPasswordCommand exige la actual, cierra las otras sesiones y renueva la actual (NV-32)', async () => {
    const session = await deps.sessions.create({
      kind: 'admin',
      userId: admin.id,
      customerId: null,
    })
    const other = await deps.sessions.create({ kind: 'admin', userId: admin.id, customerId: null })
    const change = new ChangeAdminPasswordCommand(deps.users, deps.hasher, deps.sessions)

    await expect(
      change.execute(
        admin.id,
        { currentPassword: 'no-es-esta-1', newPassword: 'nueva-2027-x' },
        session.id,
      ),
    ).resolves.toEqual(err('wrong_current_password'))
    expect(deps.users.users.get(admin.id)?.passwordHash).toBe(`hashed:${PASSWORD}`)
    expect(await deps.sessions.get(other.id)).not.toBeNull()

    await expect(
      change.execute(
        admin.id,
        { currentPassword: PASSWORD, newPassword: 'nueva-2027-x' },
        session.id,
      ),
    ).resolves.toEqual(ok(undefined))
    expect(deps.users.users.get(admin.id)?.passwordHash).toBe('hashed:nueva-2027-x')
    expect(await deps.sessions.get(session.id)).toMatchObject({
      id: session.id,
      csrfToken: session.csrfToken,
      expiresAt: session.expiresAt,
    })
    expect(await deps.sessions.get(other.id)).toBeNull()
  })
})

describe('IssueCsrfTokenCommand', () => {
  it('sin sesión válida abre una anónima; con una válida devuelve la misma', async () => {
    const deps = setup()
    const issue = new IssueCsrfTokenCommand(deps.sessions)

    const fresh = await issue.execute('no-existe')
    expect(fresh.created).toBe(true)
    expect(fresh.session).toMatchObject({ kind: 'anonymous', userId: null, customerId: null })
    await expect(issue.execute(null)).resolves.toMatchObject({ created: true })

    const again = await issue.execute(fresh.session.id)
    expect(again).toEqual({ session: fresh.session, created: false })
  })
})
