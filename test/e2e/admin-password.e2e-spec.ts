import { PrismaPg } from '@prisma/adapter-pg'
import { verify } from 'argon2'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { adminPasswordCredentials, setAdminPassword } from '../../prisma/admin-password'
import { PrismaClient } from '../../src/generated/prisma/client'
import { startContainers, type TestContainers } from '../support/containers'

describe('npm run admin:password (B8)', () => {
  let containers: TestContainers | undefined
  let prisma: PrismaClient | undefined

  /** El cliente de Prisma del test; falla claro si `beforeAll` no llegó a crearlo. */
  function db(): PrismaClient {
    if (prisma === undefined) throw new Error('El cliente de Prisma no se creó en beforeAll')
    return prisma
  }

  beforeAll(async () => {
    containers = await startContainers()
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: containers.databaseUrl }),
    })
  })

  afterAll(async () => {
    await prisma?.$disconnect()
    await containers?.stop()
  })

  it('crea el admin si no existe y no toca ninguna otra tabla', async () => {
    const outcome = await setAdminPassword(db(), {
      email: 'duena@galponmates.com.ar',
      password: 'una-clave-larga-2026',
    })

    expect(outcome).toBe('created')
    const admin = await db().user.findUniqueOrThrow({
      where: { email: 'duena@galponmates.com.ar' },
    })
    expect(admin).toMatchObject({ role: 'admin', status: 'active' })
    expect(admin.passwordHash).toMatch(/^\$argon2id\$/)
    expect(await verify(admin.passwordHash, 'una-clave-larga-2026')).toBe(true)
    expect(await db().product.count()).toBe(0)
    expect(await db().category.count()).toBe(0)
  })

  it('si ya existe le cambia la contraseña y lo reactiva, sin crear otro', async () => {
    const before = await db().user.findUniqueOrThrow({
      where: { email: 'duena@galponmates.com.ar' },
    })
    await db().user.update({ where: { id: before.id }, data: { status: 'disabled' } })

    const outcome = await setAdminPassword(db(), {
      email: 'duena@galponmates.com.ar',
      password: 'otra-clave-nueva-2027',
    })

    expect(outcome).toBe('updated')
    const after = await db().user.findUniqueOrThrow({ where: { id: before.id } })
    expect(after.status).toBe('active')
    expect(await verify(after.passwordHash, 'otra-clave-nueva-2027')).toBe(true)
    expect(await verify(after.passwordHash, 'una-clave-larga-2026')).toBe(false)
    expect(await db().user.count()).toBe(1)
  })

  it('no convierte en admin a una cuenta de cliente', async () => {
    await db().user.create({
      data: { email: 'cliente@example.com', passwordHash: 'x', role: 'customer' },
    })

    await expect(
      setAdminPassword(db(), { email: 'cliente@example.com', password: 'una-clave-larga-2026' }),
    ).rejects.toThrow('cuenta de cliente')
    const customer = await db().user.findUniqueOrThrow({ where: { email: 'cliente@example.com' } })
    expect(customer).toMatchObject({ role: 'customer', passwordHash: 'x' })
  })
})

describe('adminPasswordCredentials (sin base)', () => {
  it('exige las dos variables en cualquier entorno, sin mostrar la contraseña', () => {
    const missing =
      'Hacen falta ADMIN_EMAIL (el email del admin) y ADMIN_PASSWORD (la contraseña nueva, de 12 caracteres o más).'
    expect(() => adminPasswordCredentials({ NODE_ENV: 'development' })).toThrow(missing)
    expect(() =>
      adminPasswordCredentials({ NODE_ENV: 'production', ADMIN_EMAIL: 'a@galpon.test' }),
    ).toThrow(missing)
    const short = (): unknown =>
      adminPasswordCredentials({
        NODE_ENV: 'production',
        ADMIN_EMAIL: 'a@galpon.test',
        ADMIN_PASSWORD: 'corta-2026',
      })
    expect(short).toThrow('12 caracteres o más')
    expect(short).not.toThrow('corta-2026')
  })

  it('con las dos variables normaliza el email', () => {
    expect(
      adminPasswordCredentials({
        NODE_ENV: 'production',
        ADMIN_EMAIL: ' Duena@GalponMates.com.ar ',
        ADMIN_PASSWORD: 'una-clave-larga-2026',
      }),
    ).toEqual({ email: 'duena@galponmates.com.ar', password: 'una-clave-larga-2026' })
  })
})
