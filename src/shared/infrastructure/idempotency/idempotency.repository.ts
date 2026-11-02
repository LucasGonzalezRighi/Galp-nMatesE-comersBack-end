import { Injectable } from '@nestjs/common'

import { Prisma } from '../../../generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'

/** Respuesta guardada de un pedido idempotente ya completado. */
export interface StoredResponse {
  /** Código HTTP con el que se respondió. */
  status: number
  /** Cuerpo de la respuesta (JSON), o `null` si no tenía. */
  body: unknown
}

/** Datos para registrar el comienzo de un pedido con `Idempotency-Key`. */
export interface IdempotencyBeginInput {
  /** Alcance de la clave (por ejemplo `orders`): la misma clave en otro alcance es otra. */
  scope: string
  /** La `Idempotency-Key` (UUID). */
  key: string
  /** Hash del pedido (método, ruta y cuerpo), para detectar otra petición con la misma clave. */
  requestHash: string
  /** Hora actual. */
  now: Date
  /** Hasta cuándo se considera en proceso; pasado ese momento otra petición puede retomarla. */
  lockedUntil: Date
  /** Cuándo vence la clave (24 h). */
  expiresAt: Date
}

/** La clave es nueva (o venció): hay que ejecutar el pedido. */
export interface IdempotencyStarted {
  outcome: 'started'
}

/** La clave ya se completó con el mismo pedido: se devuelve la respuesta guardada. */
export interface IdempotencyReplay {
  outcome: 'replay'
  /** La respuesta del primer intento. */
  response: StoredResponse
}

/** La clave ya se usó con otro pedido. */
export interface IdempotencyMismatch {
  outcome: 'mismatch'
}

/** La clave se está procesando en otra petición. */
export interface IdempotencyInProgress {
  outcome: 'in_progress'
}

/** Resultado de {@link IdempotencyRepository.begin}. */
export type IdempotencyBeginResult =
  IdempotencyStarted | IdempotencyReplay | IdempotencyMismatch | IdempotencyInProgress

/** Almacenamiento de las `Idempotency-Key` (tabla `idempotency_keys`). */
export interface IdempotencyRepository {
  /**
   * Registra la clave como "en proceso" si es nueva, venció o quedó trabada con el mismo pedido;
   * si no, dice qué pasa con ella.
   */
  begin(input: IdempotencyBeginInput): Promise<IdempotencyBeginResult>
  /** Marca la clave como completada y guarda la respuesta. */
  complete(scope: string, key: string, response: StoredResponse): Promise<void>
  /** Borra una clave en proceso (el pedido falló), para que se pueda reintentar con ella. */
  release(scope: string, key: string): Promise<void>
}

/** Token de inyección del repositorio de claves de idempotencia. */
export const IDEMPOTENCY_REPOSITORY = Symbol('IDEMPOTENCY_REPOSITORY')

/** Cuántas veces `begin` reintenta si la clave desaparece entre el `INSERT` y la lectura. */
const BEGIN_ATTEMPTS = 2

function toJson(body: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  const serialized = JSON.stringify(body) as string | undefined
  if (serialized === undefined || serialized === 'null') return Prisma.DbNull
  return JSON.parse(serialized) as Prisma.InputJsonValue
}

/**
 * Repositorio de claves de idempotencia en Postgres. `begin` es atómico: un
 * `INSERT … ON CONFLICT DO UPDATE … WHERE` toma la clave solo si es nueva, venció o su lock
 * expiró con el mismo pedido, así dos peticiones simultáneas no la toman las dos.
 */
@Injectable()
export class PrismaIdempotencyRepository implements IdempotencyRepository {
  /** @param prisma - Cliente de Prisma de la app. */
  constructor(private readonly prisma: PrismaService) {}

  /**
   * @param input - Alcance, clave, hash del pedido y horarios.
   * @returns Qué hacer con el pedido.
   * @throws {TypeError} En español, si el alcance o la clave están vacíos.
   */
  async begin(input: IdempotencyBeginInput): Promise<IdempotencyBeginResult> {
    if (input.scope === '' || input.key === '') {
      throw new TypeError('El alcance y la clave de idempotencia no pueden estar vacíos')
    }
    for (let attempt = 0; attempt < BEGIN_ATTEMPTS; attempt += 1) {
      const taken = await this.prisma.$queryRaw<{ scope: string }[]>`
        INSERT INTO idempotency_keys
          (scope, "key", request_hash, status, locked_until, expires_at, created_at, updated_at)
        VALUES (${input.scope}, ${input.key}, ${input.requestHash}, 'processing',
          ${input.lockedUntil}, ${input.expiresAt}, ${input.now}, ${input.now})
        ON CONFLICT (scope, "key") DO UPDATE SET
          request_hash = EXCLUDED.request_hash,
          status = 'processing',
          response_status = NULL,
          response_body = NULL,
          locked_until = EXCLUDED.locked_until,
          expires_at = EXCLUDED.expires_at,
          created_at = EXCLUDED.created_at,
          updated_at = EXCLUDED.updated_at
        WHERE idempotency_keys.expires_at <= ${input.now}
          OR (idempotency_keys.status = 'processing'
            AND idempotency_keys.locked_until <= ${input.now}
            AND idempotency_keys.request_hash = EXCLUDED.request_hash)
        RETURNING scope`
      if (taken.length > 0) return { outcome: 'started' }

      const row = await this.prisma.idempotencyKey.findUnique({
        where: { scope_key: { scope: input.scope, key: input.key } },
      })
      if (row === null) continue
      if (row.requestHash !== input.requestHash) return { outcome: 'mismatch' }
      if (row.status === 'completed' && row.responseStatus !== null) {
        return {
          outcome: 'replay',
          response: { status: row.responseStatus, body: row.responseBody },
        }
      }
      return { outcome: 'in_progress' }
    }
    return { outcome: 'in_progress' }
  }

  /**
   * @param scope - Alcance de la clave.
   * @param key - La clave.
   * @param response - Status y cuerpo (serializable a JSON) de la respuesta.
   */
  async complete(scope: string, key: string, response: StoredResponse): Promise<void> {
    await this.prisma.idempotencyKey.updateMany({
      where: { scope, key },
      data: {
        status: 'completed',
        responseStatus: response.status,
        responseBody: toJson(response.body),
        lockedUntil: null,
      },
    })
  }

  /**
   * @param scope - Alcance de la clave.
   * @param key - La clave.
   */
  async release(scope: string, key: string): Promise<void> {
    await this.prisma.idempotencyKey.deleteMany({ where: { scope, key, status: 'processing' } })
  }
}
