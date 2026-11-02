import { Body, Controller, Post, type Type } from '@nestjs/common'
import { IsInt, IsOptional, IsString, Max, Min, MinLength } from 'class-validator'
import { setTimeout as sleep } from 'node:timers/promises'

import { Idempotent } from '../../src/shared/infrastructure/idempotency/idempotency.interceptor'

/** Cuerpo de la ruta de prueba. */
export class IdempotentTestDto {
  /** Texto que la ruta devuelve tal cual. */
  @IsString({ message: 'La nota tiene que ser un texto.' })
  @MinLength(1, { message: 'La nota no puede estar vacía.' })
  note = ''

  /** Demora artificial del handler, para probar el 409 mientras se procesa. */
  @IsOptional()
  @IsInt({ message: 'La demora tiene que ser un número entero.' })
  @Min(0, { message: 'La demora tiene que ser mayor o igual a 0.' })
  @Max(5_000, { message: 'La demora tiene que ser menor o igual a 5000.' })
  delayMs?: number
}

/** Respuesta de la ruta de prueba. */
export interface IdempotentTestResponse {
  /** La nota recibida. */
  note: string
  /** Número de ejecución del handler (si se repite la respuesta guardada, no cambia). */
  call: number
}

/**
 * Ruta de prueba `POST /api/v1/_test/idempotent` con `@Idempotent('test')`, para el E2E del
 * interceptor contra Postgres real. Vive solo en `test/`: la app nunca la registra.
 */
@Controller('_test/idempotent')
export class IdempotencyTestController {
  private calls = 0

  /**
   * @param body - Nota y demora opcional.
   * @returns La nota y el número de ejecución.
   */
  @Post()
  @Idempotent('test')
  async create(@Body() body: IdempotentTestDto): Promise<IdempotentTestResponse> {
    this.calls += 1
    const call = this.calls
    if (body.delayMs !== undefined) await sleep(body.delayMs)
    return { note: body.note, call }
  }
}

/**
 * Controladores que solo existen en los tests.
 *
 * @returns `[IdempotencyTestController]` con `NODE_ENV=test` (vitest lo pone solo); si no, nada.
 */
export function testOnlyControllers(): Type[] {
  return process.env.NODE_ENV === 'test' ? [IdempotencyTestController] : []
}
