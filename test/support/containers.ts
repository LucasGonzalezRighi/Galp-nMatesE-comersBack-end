import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis'
import { execSync } from 'node:child_process'

/** Imagen de Postgres de los E2E: la misma que `docker-compose.yml`. */
export const POSTGRES_IMAGE = 'postgres:17-alpine'

/** Imagen de Redis de los E2E: la misma que `docker-compose.yml`. */
export const REDIS_IMAGE = 'redis:8-alpine'

/** Postgres y Redis propios de un archivo de E2E, en puertos aleatorios. */
export interface TestContainers {
  /** URL de Postgres, con las migraciones ya aplicadas (`prisma migrate deploy`). */
  databaseUrl: string
  /** URL de Redis (`redis://host:puerto`). */
  redisUrl: string
  /** Detiene los dos contenedores (cada uno, solo si sigue andando). */
  stop(): Promise<void>
  /** Detiene solo Redis, para probar la app con Redis caído (health `degraded`). */
  stopRedis(): Promise<void>
  /** Detiene solo Postgres, para probar la app con la base caída (health 503). */
  stopPostgres(): Promise<void>
}

/**
 * Aplica las migraciones de `prisma/migrations` contra una base.
 *
 * @param databaseUrl - URL de la base, que pisa la del entorno y la de `.env`.
 * @throws {Error} Si `prisma migrate deploy` falla, con su salida en el mensaje.
 */
function migrate(databaseUrl: string): void {
  try {
    execSync('npx prisma migrate deploy', {
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: 'pipe',
    })
  } catch (error) {
    const output = error instanceof Error && 'stderr' in error ? String(error.stderr) : ''
    throw new Error(`No se pudieron aplicar las migraciones de Prisma: ${output}`, {
      cause: error,
    })
  }
}

/**
 * Levanta Postgres 17 y Redis 8 con Testcontainers y migra la base.
 *
 * Necesita Docker Desktop abierto. Cada archivo de E2E levanta los suyos y los cierra con
 * `stop()` en `afterAll`; si el proceso muere antes, Testcontainers los borra igual.
 *
 * @returns Las URLs de conexión y las funciones para detener los contenedores.
 * @throws {Error} Si Docker no responde o si las migraciones fallan (en ese caso detiene antes
 *   los contenedores que llegó a levantar).
 * @example
 * const containers = await startContainers()
 * process.env.DATABASE_URL = containers.databaseUrl
 * // …
 * await containers.stop()
 */
export async function startContainers(): Promise<TestContainers> {
  const [postgres, redis]: [StartedPostgreSqlContainer, StartedRedisContainer] = await Promise.all([
    new PostgreSqlContainer(POSTGRES_IMAGE).start(),
    new RedisContainer(REDIS_IMAGE).start(),
  ])
  let redisRunning = true
  let postgresRunning = true

  const stopRedis = async (): Promise<void> => {
    if (!redisRunning) return
    redisRunning = false
    await redis.stop()
  }
  const stopPostgres = async (): Promise<void> => {
    if (!postgresRunning) return
    postgresRunning = false
    await postgres.stop()
  }
  const stop = async (): Promise<void> => {
    await Promise.all([stopPostgres(), stopRedis()])
  }

  const databaseUrl = postgres.getConnectionUri()
  try {
    migrate(databaseUrl)
  } catch (error) {
    await stop()
    throw error
  }

  return { databaseUrl, redisUrl: redis.getConnectionUrl(), stop, stopRedis, stopPostgres }
}
