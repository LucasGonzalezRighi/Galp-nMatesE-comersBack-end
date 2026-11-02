import { Injectable } from '@nestjs/common'
import { type HealthIndicatorResult, HealthIndicatorService } from '@nestjs/terminus'

import { PrismaService } from './prisma.service'

/**
 * Indicador de Terminus para Postgres (`SELECT 1`). Postgres es crítico (los pedidos y pagos
 * viven ahí), así que caído da `down`: el health queda en `status: 'error'` con HTTP 503
 * (Review Focus 4).
 */
@Injectable()
export class PrismaHealthIndicator {
  constructor(
    private readonly prisma: PrismaService,
    private readonly health: HealthIndicatorService,
  ) {}

  /**
   * Revisa Postgres con un `SELECT 1`.
   *
   * @param key - Nombre del indicador en la respuesta (por ejemplo `database`).
   * @returns `{ [key]: { status: 'up' } }` o, si no responde, `{ [key]: { status: 'down', message } }`.
   */
  async isHealthy<const Key extends string>(key: Key): Promise<HealthIndicatorResult<Key>> {
    const indicator = this.health.check(key)
    try {
      await this.prisma.$queryRaw`SELECT 1`
      return indicator.up()
    } catch {
      return indicator.down({ message: 'Postgres no responde' })
    }
  }
}
