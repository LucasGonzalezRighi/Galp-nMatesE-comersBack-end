import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool, type PoolConfig } from 'pg'

import { ENV, type Env } from '../../../config/env'
import { PrismaClient } from '../../../generated/prisma/client'

/**
 * Cuánto espera un pedido por una conexión del pool antes de fallar: si la base no responde o el
 * pool está agotado, el pedido termina en error en lugar de quedar colgado.
 */
export const DB_CONNECTION_TIMEOUT_MS = 10_000

/** Tope de cada consulta en Postgres (`statement_timeout`): una consulta trabada no retiene su conexión. */
export const DB_STATEMENT_TIMEOUT_MS = 30_000

/**
 * Opciones del `pg.Pool` de la app.
 *
 * @param databaseUrl - `DATABASE_URL`, ya validada.
 * @returns La conexión con sus dos topes ({@link DB_CONNECTION_TIMEOUT_MS} y
 *   {@link DB_STATEMENT_TIMEOUT_MS}).
 */
export function buildPoolConfig(databaseUrl: string): PoolConfig {
  return {
    connectionString: databaseUrl,
    connectionTimeoutMillis: DB_CONNECTION_TIMEOUT_MS,
    statement_timeout: DB_STATEMENT_TIMEOUT_MS,
  }
}

/**
 * Cliente de Prisma 7 de la app, con el driver adapter de `pg` sobre un `pg.Pool` propio.
 *
 * Solo lo usan los adaptadores de `infrastructure`. Al iniciar el módulo comprueba que Postgres
 * responde y, al cerrar la app, desconecta Prisma y cierra el pool (el adapter no cierra un
 * pool ajeno).
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly pool: Pool

  /**
   * Crea el pool con `DATABASE_URL`, ya validada por `ConfigModule` al arrancar, y los topes de
   * {@link buildPoolConfig}.
   *
   * @param env - Variables de entorno validadas (token `ENV`).
   */
  constructor(@Inject(ENV) env: Env) {
    const pool = new Pool(buildPoolConfig(env.DATABASE_URL))
    super({ adapter: new PrismaPg(pool) })
    this.pool = pool
  }

  /**
   * Verifica al arrancar que Postgres responde, para fallar temprano (es crítico, a diferencia
   * de Redis). Hace un `SELECT 1` y no `$connect()`: con el driver adapter de Prisma 7,
   * `$connect()` no abre ninguna conexión y resuelve aunque la base esté caída.
   *
   * @throws {Error} En español, si Postgres no responde (el error original queda en `cause`).
   */
  async onModuleInit(): Promise<void> {
    try {
      await this.$queryRaw`SELECT 1`
    } catch (error) {
      throw new Error(
        'No se pudo conectar a Postgres: revisá DATABASE_URL y que la base esté levantada',
        { cause: error },
      )
    }
  }

  /** Desconecta Prisma y cierra el pool de `pg`. */
  async onModuleDestroy(): Promise<void> {
    await this.$disconnect()
    await this.pool.end()
  }
}
