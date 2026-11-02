import {
  type CallHandler,
  ConflictException,
  type CustomDecorator,
  type ExecutionContext,
  Inject,
  Injectable,
  Logger,
  type NestInterceptor,
  SetMetadata,
  UnprocessableEntityException,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { createHash } from 'node:crypto'
import { catchError, concatMap, from, type Observable, of, throwError } from 'rxjs'
import { validate as isUuid } from 'uuid'

import { CLOCK, type Clock } from '../../domain/clock'
import { validationProblem } from '../http/validation.pipe'
import { IDEMPOTENCY_REPOSITORY, type IdempotencyRepository } from './idempotency.repository'

/** Clave de metadata donde `@Idempotent` guarda el alcance. */
export const IDEMPOTENT_SCOPE = 'galpon:idempotent-scope'

/** Header con la clave de idempotencia (parámetro `IdempotencyKey` del contrato). */
export const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key'

/** Header que marca una respuesta repetida desde la guardada. */
export const REPLAYED_HEADER = 'Idempotent-Replayed'

/** Vigencia de una clave: 24 horas. */
export const IDEMPOTENCY_KEY_TTL_MS = 24 * 60 * 60 * 1_000

/** Cuánto se considera "en proceso" un pedido antes de que otro con la misma clave lo retome. */
export const IDEMPOTENCY_LOCK_MS = 60_000

const SCOPE_PATTERN = /^[a-z][a-z0-9_.-]*$/

/**
 * Marca una ruta como idempotente: exige el header `Idempotency-Key` (UUID) y, con la misma
 * clave, devuelve la respuesta del primer intento en vez de ejecutar de nuevo el handler.
 *
 * @param scope - Alcance de las claves (por ejemplo `orders`), en minúsculas.
 * @returns El decorador.
 * @throws {TypeError} En español, si el alcance está vacío o no está en minúsculas.
 * @example
 * \@Post()
 * \@Idempotent('orders')
 * create(@Body() body: CreateOrderDto) { … }
 */
export function Idempotent(scope: string): CustomDecorator {
  if (!SCOPE_PATTERN.test(scope)) {
    throw new TypeError(
      `El alcance de @Idempotent tiene que ser un texto en minúsculas (llegó "${scope}")`,
    )
  }
  return SetMetadata(IDEMPOTENT_SCOPE, scope)
}

/** Lo que el interceptor lee del pedido. */
interface IdempotentRequest {
  method: string
  originalUrl: string
  headers: Record<string, string | string[] | undefined>
  body: unknown
}

/** Lo que el interceptor usa de la respuesta. */
interface IdempotentResponse {
  statusCode: number
  setHeader(name: string, value: string): unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Copia del valor con las claves de los objetos ordenadas, para un JSON estable. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    )
  }
  return value
}

/**
 * Hash SHA-256 de un pedido: método, ruta y cuerpo (con las claves ordenadas, así el orden de
 * los campos no cambia el hash).
 *
 * @param method - Método HTTP.
 * @param url - Ruta con la query string.
 * @param body - Cuerpo ya parseado.
 * @returns El hash en hexadecimal.
 */
export function hashRequest(method: string, url: string, body: unknown): string {
  return createHash('sha256')
    .update(`${method} ${url}\n${JSON.stringify(canonical(body ?? null))}`)
    .digest('hex')
}

function readKey(headers: IdempotentRequest['headers']): string {
  const value = headers[IDEMPOTENCY_KEY_HEADER.toLowerCase()]
  if (value === undefined || value === '') {
    throw validationProblem([
      {
        field: IDEMPOTENCY_KEY_HEADER,
        code: 'required',
        message: 'Falta el header Idempotency-Key: mandá un UUID nuevo por cada intento.',
      },
    ])
  }
  if (typeof value !== 'string' || !isUuid(value)) {
    throw validationProblem([
      {
        field: IDEMPOTENCY_KEY_HEADER,
        code: 'invalid_uuid',
        message: 'El header Idempotency-Key tiene que ser un UUID.',
      },
    ])
  }
  return value.toLowerCase()
}

/**
 * Interceptor global de idempotencia (spec §5). En las rutas con `@Idempotent(scope)`:
 *
 * - sin `Idempotency-Key` o con una que no es UUID → 422 `validation_error`;
 * - clave nueva → ejecuta el handler y guarda status y cuerpo (vence a las 24 h);
 * - misma clave y mismo pedido ya completado → la respuesta guardada, con
 *   `Idempotent-Replayed: true`, sin ejecutar el handler;
 * - misma clave con otro pedido → 422 `idempotency_key_reused`;
 * - misma clave mientras se procesa → 409 `idempotency_in_progress`.
 *
 * Si el handler falla, la clave se libera para poder reintentar. La respuesta repetida sale con
 * el status de la ruta, que es el mismo que el del primer intento.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name)

  /**
   * @param reflector - Lee el alcance de `@Idempotent`.
   * @param repository - Dónde se guardan las claves.
   * @param clock - Reloj de la app.
   */
  constructor(
    private readonly reflector: Reflector,
    @Inject(IDEMPOTENCY_REPOSITORY) private readonly repository: IdempotencyRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * @param context - Contexto de la ruta.
   * @param next - El handler.
   * @returns La respuesta del handler, o la guardada si es una repetición.
   * @throws {UnprocessableEntityException} Si falta la clave, no es UUID o se usó con otro
   *   pedido.
   * @throws {ConflictException} Si la clave se está procesando.
   */
  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const scope = this.reflector.getAllAndOverride<string | undefined>(IDEMPOTENT_SCOPE, [
      context.getHandler(),
      context.getClass(),
    ])
    if (scope === undefined) return next.handle()

    const http = context.switchToHttp()
    const req = http.getRequest<IdempotentRequest>()
    const res = http.getResponse<IdempotentResponse>()
    const key = readKey(req.headers)
    const now = this.clock.now()
    const result = await this.repository.begin({
      scope,
      key,
      requestHash: hashRequest(req.method, req.originalUrl, req.body),
      now,
      lockedUntil: new Date(now.getTime() + IDEMPOTENCY_LOCK_MS),
      expiresAt: new Date(now.getTime() + IDEMPOTENCY_KEY_TTL_MS),
    })

    switch (result.outcome) {
      case 'replay':
        res.setHeader(REPLAYED_HEADER, 'true')
        return of(result.response.body)
      case 'mismatch':
        throw new UnprocessableEntityException({
          type: 'idempotency_key_reused',
          title: 'La clave ya se usó',
          detail:
            'La Idempotency-Key ya se usó con otros datos. Generá una nueva para este intento.',
        })
      case 'in_progress':
        throw new ConflictException({
          type: 'idempotency_in_progress',
          title: 'El pedido se está procesando',
          detail:
            'Ya estamos procesando un pedido con esta Idempotency-Key. Esperá unos segundos y volvé a intentar.',
        })
      case 'started':
        return next.handle().pipe(
          concatMap(async (body: unknown) => {
            await this.complete(scope, key, res.statusCode, body)
            return body
          }),
          catchError((error: unknown) =>
            from(this.release(scope, key)).pipe(concatMap(() => throwError(() => error))),
          ),
        )
    }
  }

  /** Guarda la respuesta; si falla, lo loguea y la respuesta sale igual (el pedido ya se hizo). */
  private async complete(scope: string, key: string, status: number, body: unknown): Promise<void> {
    try {
      await this.repository.complete(scope, key, { status, body })
    } catch (error) {
      this.logger.error(
        `No se pudo guardar la respuesta de la Idempotency-Key ${scope}/${key}`,
        error instanceof Error ? error.stack : String(error),
      )
    }
  }

  /** Libera la clave tras un error del handler; si falla, lo loguea (el lock vence solo). */
  private async release(scope: string, key: string): Promise<void> {
    try {
      await this.repository.release(scope, key)
    } catch (error) {
      this.logger.error(
        `No se pudo liberar la Idempotency-Key ${scope}/${key}`,
        error instanceof Error ? error.stack : String(error),
      )
    }
  }
}
