import { defineConfig } from 'prisma/config'

// Prisma 7 ya no carga `.env` solo. Si existe, lo carga Node (las variables que ya están en el
// entorno ganan, así los E2E pueden apuntar a su contenedor); si no existe, se sigue sin él.
try {
  process.loadEnvFile()
} catch {
  // Sin `.env`: valen las variables del entorno.
}

/**
 * Configuración de la CLI de Prisma: esquema, migraciones y la base contra la que corren
 * `migrate dev`, `migrate deploy` y `migrate reset` (`DATABASE_URL`).
 *
 * `prisma generate` no se conecta, por eso la URL puede faltar al instalar (`postinstall`).
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env.DATABASE_URL ?? '' },
})
