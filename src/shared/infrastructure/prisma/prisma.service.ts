import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

import { ENV, type Env } from '../../../config/env'
import { PrismaClient } from '../../../generated/prisma/client'

/**
 * Cliente de Prisma 7 de la app, con el driver adapter de `pg` sobre un `pg.Pool` propio.
 *
 * Solo lo usan los adaptadores de `infrastructure`. Se conecta al iniciar el módulo y, al
 * cerrar la app, desconecta Prisma y cierra el pool (el adapter no cierra un pool ajeno).
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly pool: Pool

  /**
   * Crea el pool con `DATABASE_URL`, ya validada por `ConfigModule` al arrancar.
   *
   * @param env - Variables de entorno validadas (token `ENV`).
   */
  constructor(@Inject(ENV) env: Env) {
    const pool = new Pool({ connectionString: env.DATABASE_URL })
    super({ adapter: new PrismaPg(pool) })
    this.pool = pool
  }

  /** Abre la conexión al arrancar, para fallar temprano si la base no responde. */
  async onModuleInit(): Promise<void> {
    await this.$connect()
  }

  /** Desconecta Prisma y cierra el pool de `pg`. */
  async onModuleDestroy(): Promise<void> {
    await this.$disconnect()
    await this.pool.end()
  }
}
