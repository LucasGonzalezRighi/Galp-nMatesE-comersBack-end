// Crea el admin del dashboard o le cambia la contraseña, sin tocar nada más de la base.
// Se corre con `npm run admin:password`, con `ADMIN_EMAIL` y `ADMIN_PASSWORD` en el entorno (o en
// `.env`). Es la forma de recuperar el acceso en producción: a diferencia del seed, no vuelve el
// catálogo a los valores del diseño.
import { PrismaPg } from '@prisma/adapter-pg'
import { hash } from 'argon2'

import { PrismaClient } from '../src/generated/prisma/client'
import { PASSWORD_HASH_OPTIONS } from './seed'
import { type SeedAdminCredentials, seedAdminCredentials } from './seed-data/admin'

/** Qué hizo {@link setAdminPassword}: creó el admin o le cambió la contraseña al que ya estaba. */
export type AdminPasswordOutcome = 'created' | 'updated'

/**
 * Credenciales para `npm run admin:password`: siempre las dos variables propias, en cualquier
 * entorno (acá no vale el admin de demostración), con las reglas de {@link seedAdminCredentials}.
 *
 * @param env - Las variables de entorno.
 * @returns El email (recortado y en minúsculas) y la contraseña.
 * @throws {Error} En español, si falta `ADMIN_EMAIL` o `ADMIN_PASSWORD` o si alguna no es válida.
 *   Nunca muestra la contraseña.
 */
export function adminPasswordCredentials(
  env: Record<string, string | undefined>,
): SeedAdminCredentials {
  const hasEmail = (env.ADMIN_EMAIL ?? '').trim() !== ''
  const hasPassword = (env.ADMIN_PASSWORD ?? '') !== ''
  if (!hasEmail || !hasPassword) {
    throw new Error(
      'Hacen falta ADMIN_EMAIL (el email del admin) y ADMIN_PASSWORD (la contraseña nueva, de 12 caracteres o más).',
    )
  }
  return seedAdminCredentials(env)
}

/**
 * Deja un admin activo con ese email y esa contraseña: lo crea si no existe y, si ya existe, le
 * cambia la contraseña y lo reactiva. No toca nada más. Las sesiones que el admin tenga abiertas
 * siguen hasta vencer.
 *
 * @param prisma - Cliente de Prisma conectado a la base.
 * @param admin - Email (en minúsculas) y contraseña en claro.
 * @returns `created` o `updated`.
 * @throws {Error} En español, si el email es de una cuenta de cliente (no se la convierte en admin).
 */
export async function setAdminPassword(
  prisma: PrismaClient,
  admin: SeedAdminCredentials,
): Promise<AdminPasswordOutcome> {
  const existing = await prisma.user.findUnique({
    where: { email: admin.email },
    select: { id: true, role: true },
  })
  if (existing !== null && existing.role !== 'admin') {
    throw new Error(
      'Ese email es de una cuenta de cliente de la tienda: usá otro email para el admin.',
    )
  }
  const passwordHash = await hash(admin.password, PASSWORD_HASH_OPTIONS)
  if (existing === null) {
    await prisma.user.create({
      data: { email: admin.email, passwordHash, role: 'admin', status: 'active' },
    })
    return 'created'
  }
  await prisma.user.update({
    where: { id: existing.id },
    data: { passwordHash, status: 'active' },
  })
  return 'updated'
}

/**
 * Entrada de `npm run admin:password`: usa la base de `DATABASE_URL` (del entorno o de `.env`).
 *
 * @throws {Error} Si falta `DATABASE_URL` o las credenciales no son válidas.
 */
async function main(): Promise<void> {
  try {
    process.loadEnvFile()
  } catch {
    // Sin `.env`: valen las variables del entorno.
  }
  const connectionString = process.env.DATABASE_URL
  if (connectionString === undefined || connectionString === '') {
    throw new Error('Falta DATABASE_URL: definila en el entorno o en .env')
  }
  const admin = adminPasswordCredentials(process.env)
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) })
  try {
    const outcome = await setAdminPassword(prisma, admin)
    process.stdout.write(
      outcome === 'created'
        ? `Admin creado: ${admin.email}.\n`
        : `Contraseña cambiada para el admin ${admin.email}.\n`,
    )
  } finally {
    await prisma.$disconnect()
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `No se pudo guardar el admin: ${error instanceof Error ? error.message : String(error)}\n`,
    )
    process.exitCode = 1
  })
}
