import type { INestApplication } from '@nestjs/common'
import { createHash } from 'node:crypto'
import type { Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { seed } from '../../prisma/seed'
import { SEED_ADMIN } from '../../prisma/seed-data/admin'
import { ENV, type Env } from '../../src/config/env'
import { RequestPasswordResetCommand } from '../../src/modules/identity/application/commands/request-password-reset.command'
import { ResetPasswordCommand } from '../../src/modules/identity/application/commands/reset-password.command'
import {
  ADDRESS_REPOSITORY,
  type AddressRepository,
} from '../../src/modules/identity/application/ports/address.repository.port'
import {
  CUSTOMER_REPOSITORY,
  type CustomerRepository,
} from '../../src/modules/identity/application/ports/customer.repository.port'
import {
  LOGIN_ATTEMPTS_PORT,
  type LoginAttemptsPort,
} from '../../src/modules/identity/application/ports/login-attempts.port'
import {
  PASSWORD_HASHER,
  type PasswordHasher,
} from '../../src/modules/identity/application/ports/password-hasher.port'
import {
  PASSWORD_RESET_REPOSITORY,
  type PasswordResetRepository,
} from '../../src/modules/identity/application/ports/password-reset.repository.port'
import {
  USER_REPOSITORY,
  type NewUser,
  type UserRepository,
} from '../../src/modules/identity/application/ports/user.repository.port'
import { GetMeQuery } from '../../src/modules/identity/application/queries/get-me.query'
import type { AddressInput } from '../../src/modules/identity/domain/address.entity'
import { EmailAlreadyRegisteredError } from '../../src/modules/identity/domain/identity-errors'
import { newId } from '../../src/shared/domain/id'
import { PrismaService } from '../../src/shared/infrastructure/prisma/prisma.service'
import { createApp } from '../support/app'
import { startContainers, type TestContainers } from '../support/containers'
import { RecordingMailer } from '../support/identity'

/** Una dirección válida de la libreta. */
const HOME: AddressInput = {
  label: 'Casa',
  street: 'Av. Corrientes',
  number: '1234',
  apartment: null,
  postalCode: 'C1043AAZ',
  city: 'CABA',
  province: 'CABA',
  isDefault: true,
}

describe('adaptadores de identidad (Postgres + Redis)', () => {
  let containers: TestContainers | undefined
  let app: INestApplication<Server> | undefined
  const mailer = new RecordingMailer()
  const previousEnv = { DATABASE_URL: process.env.DATABASE_URL, REDIS_URL: process.env.REDIS_URL }

  beforeAll(async () => {
    containers = await startContainers()
    process.env.DATABASE_URL = containers.databaseUrl
    process.env.REDIS_URL = containers.redisUrl
    app = await createApp({ mailer })
    await seed(app.get(PrismaService))
  })

  afterAll(async () => {
    await app?.close()
    await containers?.stop()
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) Reflect.deleteProperty(process.env, key)
      else process.env[key] = value
    }
  })

  /** Saca un proveedor de la app ya armada. */
  function get<T>(token: symbol | (new (...args: never[]) => T)): T {
    if (app === undefined) throw new Error('La app no arrancó')
    return app.get<T>(token)
  }

  const users = () => get<UserRepository>(USER_REPOSITORY)
  const customers = () => get<CustomerRepository>(CUSTOMER_REPOSITORY)
  const addresses = () => get<AddressRepository>(ADDRESS_REPOSITORY)
  const resets = () => get<PasswordResetRepository>(PASSWORD_RESET_REPOSITORY)
  const hasher = () => get<PasswordHasher>(PASSWORD_HASHER)
  const prisma = () => get(PrismaService)

  /** Usuario cliente nuevo (sin guardar) con un hash real. */
  async function newUser(email: string): Promise<NewUser> {
    return {
      id: newId(),
      email,
      passwordHash: await hasher().hash('clave-segura-2026'),
      role: 'customer',
      status: 'active',
    }
  }

  /** Crea una cuenta de cliente completa y devuelve el id del cliente. */
  async function account(email: string): Promise<{ userId: string; customerId: string }> {
    const user = await newUser(email)
    const customer = await customers().createWithUser(user, {
      id: newId(),
      email,
      firstName: 'Ana',
      lastName: 'Pérez',
      phone: null,
    })
    return { userId: user.id, customerId: customer.id }
  }

  describe('usuarios', () => {
    it('el email no distingue mayúsculas (citext): se encuentra y no se repite', async () => {
      const created = await users().create(await newUser('Ana@Mail.com'))

      const found = await users().findByEmail('ana@mail.com')
      expect(found?.id).toBe(created.id)
      expect(found).toMatchObject({ role: 'customer', status: 'active', lastLoginAt: null })
      await expect(users().create(await newUser('ANA@mail.com'))).rejects.toBeInstanceOf(
        EmailAlreadyRegisteredError,
      )
    })

    it('cambia la contraseña y registra el inicio de sesión', async () => {
      const user = await users().create(await newUser('cambio@mail.com'))
      const at = new Date('2026-11-02T12:00:00.000Z')

      await users().updatePassword(user.id, await hasher().hash('clave-nueva-2026'))
      await users().touchLastLogin(user.id, at)

      const found = await users().findById(user.id)
      expect(found?.lastLoginAt?.toISOString()).toBe(at.toISOString())
      await expect(hasher().verify(found?.passwordHash ?? '', 'clave-nueva-2026')).resolves.toBe(
        true,
      )
    })

    it('el admin semilla se encuentra y su contraseña de demo verifica', async () => {
      const admin = await users().findByEmail(SEED_ADMIN.email)

      expect(admin).toMatchObject({ role: 'admin', status: 'active' })
      await expect(hasher().verify(admin?.passwordHash ?? '', SEED_ADMIN.password)).resolves.toBe(
        true,
      )
    })
  })

  describe('clientes', () => {
    it('createWithUser crea usuario y cliente juntos', async () => {
      const { userId, customerId } = await account('juntos@mail.com')

      await expect(customers().findByUserId(userId)).resolves.toMatchObject({
        id: customerId,
        email: 'juntos@mail.com',
        firstName: 'Ana',
        lastName: 'Pérez',
        phone: null,
      })
    })

    it('createWithUser con un email repetido lanza 409 y no deja un usuario huérfano', async () => {
      await prisma().customer.create({
        data: { id: newId(), email: 'invitada@mail.com', firstName: 'Inés', lastName: 'Gómez' },
      })
      const user = await newUser('INVITADA@mail.com')

      await expect(
        customers().createWithUser(user, {
          id: newId(),
          email: 'INVITADA@mail.com',
          firstName: 'Inés',
          lastName: 'Gómez',
          phone: null,
        }),
      ).rejects.toBeInstanceOf(EmailAlreadyRegisteredError)
      await expect(users().findById(user.id)).resolves.toBeNull()
    })

    it('attachUser convierte un invitado en cuenta y no se puede repetir', async () => {
      const guest = await customers().create({
        id: newId(),
        userId: null,
        email: 'guest@mail.com',
        firstName: 'Invitado',
        lastName: 'Viejo',
        phone: '1144556677',
      })
      const user = await newUser('guest@mail.com')

      const attached = await customers().attachUser(guest.id, user, {
        firstName: 'Juana',
        lastName: 'López',
      })
      expect(attached).toMatchObject({
        id: guest.id,
        userId: user.id,
        firstName: 'Juana',
        lastName: 'López',
        phone: '1144556677',
      })

      const other = { ...(await newUser('otro@mail.com')) }
      await expect(
        customers().attachUser(guest.id, other, { firstName: 'X', lastName: 'Y' }),
      ).rejects.toBeInstanceOf(EmailAlreadyRegisteredError)
      await expect(users().findById(other.id)).resolves.toBeNull()
    })

    it('update cambia solo los campos definidos y null borra el teléfono', async () => {
      const { customerId } = await account('datos@mail.com')

      await customers().update(customerId, { phone: '1122334455' })
      const updated = await customers().update(customerId, { firstName: 'Anita' })
      expect(updated).toMatchObject({ firstName: 'Anita', lastName: 'Pérez', phone: '1122334455' })
      await expect(customers().update(customerId, { phone: null })).resolves.toMatchObject({
        phone: null,
      })
    })
  })

  describe('libreta de direcciones', () => {
    it('dos altas predeterminadas simultáneas dejan exactamente una, primero en la lista', async () => {
      // Varias libretas a la vez, para que en alguna las dos transacciones se crucen de verdad.
      const owners = []
      for (let i = 0; i < 8; i++) owners.push(await account(`libreta${String(i)}@mail.com`))

      await Promise.all(
        owners.map(async ({ customerId }) => {
          const created = await Promise.all([
            addresses().create({ ...HOME, id: newId(), customerId }),
            addresses().create({ ...HOME, label: 'Trabajo', id: newId(), customerId }),
          ])

          const list = await addresses().listByCustomer(customerId)
          expect(list).toHaveLength(2)
          expect(list.filter((address) => address.isDefault)).toHaveLength(1)
          expect(list[0]?.isDefault).toBe(true)
          expect(created.map((address) => address.id).sort()).toEqual(
            list.map((address) => address.id).sort(),
          )
        }),
      )
    })

    it('guarda la provincia con su texto, y replace mueve la predeterminada', async () => {
      const { customerId } = await account('mudanza@mail.com')
      const home = await addresses().create({
        ...HOME,
        province: 'Córdoba',
        id: newId(),
        customerId,
      })
      const work = await addresses().create({
        ...HOME,
        label: 'Trabajo',
        isDefault: false,
        id: newId(),
        customerId,
      })
      expect(home.province).toBe('Córdoba')

      const replaced = await addresses().replace(work.id, {
        ...HOME,
        label: 'Oficina',
        province: 'Entre Ríos',
        isDefault: true,
      })

      expect(replaced).toMatchObject({ id: work.id, customerId, label: 'Oficina', isDefault: true })
      const list = await addresses().listByCustomer(customerId)
      expect(list.map((address) => [address.id, address.isDefault])).toEqual([
        [work.id, true],
        [home.id, false],
      ])
      await expect(addresses().findOne(customerId, home.id)).resolves.toMatchObject({
        province: 'Córdoba',
      })
    })

    it('findOne no ve direcciones de otro cliente y delete borra', async () => {
      const mine = await account('mia@mail.com')
      const theirs = await account('ajena@mail.com')
      const address = await addresses().create({
        ...HOME,
        id: newId(),
        customerId: mine.customerId,
      })

      await expect(addresses().findOne(theirs.customerId, address.id)).resolves.toBeNull()
      await addresses().delete(address.id)
      await expect(addresses().findOne(mine.customerId, address.id)).resolves.toBeNull()
    })
  })

  describe('tokens de recuperación', () => {
    const now = new Date('2026-11-02T12:00:00.000Z')

    it('consume devuelve el usuario una sola vez', async () => {
      const { userId } = await account('reset@mail.com')
      await resets().create({
        userId,
        tokenHash: 'a'.repeat(64),
        expiresAt: new Date('2026-11-02T13:00:00.000Z'),
      })

      await expect(resets().consume('a'.repeat(64), now)).resolves.toEqual({ userId })
      await expect(resets().consume('a'.repeat(64), now)).resolves.toBeNull()
    })

    it('un token vencido o inexistente no sirve', async () => {
      const { userId } = await account('vencido@mail.com')
      await resets().create({ userId, tokenHash: 'b'.repeat(64), expiresAt: now })

      await expect(resets().consume('b'.repeat(64), now)).resolves.toBeNull()
      await expect(resets().consume('c'.repeat(64), now)).resolves.toBeNull()
    })

    it('el pedido manda el link de STORE_ORIGIN, guarda solo el hash y el reset lo usa una vez', async () => {
      await account('olvido@mail.com')

      await get(RequestPasswordResetCommand).execute(' Olvido@Mail.com ')

      const mail = mailer.passwordResets.at(-1)
      const origin = get<Env>(ENV).STORE_ORIGIN.replace(/\/+$/, '')
      expect(mail?.to).toBe('olvido@mail.com')
      const token = new URL(mail?.link ?? 'http://x').searchParams.get('token') ?? ''
      expect(mail?.link).toBe(`${origin}/cuenta/restablecer?token=${token}`)
      expect(token).toMatch(/^rt_[0-9a-f]{64}$/)
      const rows = await prisma().passwordResetToken.findMany({
        where: { user: { email: 'olvido@mail.com' } },
      })
      expect(rows.map((row) => row.tokenHash)).toEqual([
        createHash('sha256').update(token).digest('hex'),
      ])

      const reset = get(ResetPasswordCommand)
      await expect(reset.execute({ token, password: 'clave-nueva-2026' })).resolves.toMatchObject({
        ok: true,
      })
      await expect(reset.execute({ token, password: 'otra-clave-2026' })).resolves.toMatchObject({
        ok: false,
      })
    })
  })

  describe('bloqueo de intentos en Redis', () => {
    it('el décimo fallo bloquea por el resto de la ventana y clear lo levanta', async () => {
      const attempts = get<LoginAttemptsPort>(LOGIN_ATTEMPTS_PORT)
      const results = []
      for (let i = 0; i < 10; i++) results.push(await attempts.fail('bloqueo@mail.com'))

      expect(results.slice(0, 9).every((r) => r.blockedForSeconds === null)).toBe(true)
      expect(results[9]?.blockedForSeconds).toBeGreaterThan(890)
      expect(results[9]?.blockedForSeconds).toBeLessThanOrEqual(900)
      await expect(attempts.blockedFor('bloqueo@mail.com')).resolves.toBeGreaterThan(0)

      await attempts.clear('bloqueo@mail.com')
      await expect(attempts.blockedFor('bloqueo@mail.com')).resolves.toBeNull()
    })
  })

  it('el módulo exporta GetMeQuery', () => {
    expect(get(GetMeQuery)).toBeInstanceOf(GetMeQuery)
  })
})
