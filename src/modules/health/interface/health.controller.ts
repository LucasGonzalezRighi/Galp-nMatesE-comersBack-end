import { Controller, Get } from '@nestjs/common'

/**
 * Respuesta de `GET /api/v1/health`.
 *
 * Por ahora solo dice que la API responde; los indicadores de Postgres y Redis (Terminus)
 * llegan con la Task 4.
 */
export interface HealthStatus {
  /** `ok` cuando la API está en pie. */
  status: 'ok'
}

/** Expone el estado de la API en `GET /api/v1/health`. */
@Controller('health')
export class HealthController {
  /**
   * Informa que la API está en pie.
   *
   * @returns `{ status: 'ok' }`.
   */
  @Get()
  check(): HealthStatus {
    return { status: 'ok' }
  }
}
