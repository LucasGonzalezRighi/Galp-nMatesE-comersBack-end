import { type CallHandler, type ExecutionContext, HttpException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { lastValueFrom, type Observable, of, Subject, throwError } from 'rxjs'
import { beforeEach, describe, expect, it } from 'vitest'

import type { Clock } from '../../domain/clock'
import {
  IDEMPOTENCY_KEY_TTL_MS,
  Idempotent,
  IdempotencyInterceptor,
  REPLAYED_HEADER,
} from './idempotency.interceptor'
import type {
  IdempotencyBeginInput,
  IdempotencyBeginResult,
  IdempotencyRepository,
  StoredResponse,
} from './idempotency.repository'

/** Fila de la tabla `idempotency_keys`, en memoria. */
interface MemoryRow {
  requestHash: string
  status: 'processing' | 'completed'
  response: StoredResponse | undefined
  lockedUntil: Date
  expiresAt: Date
}

/** Repositorio en memoria con la misma semántica que el de Postgres. */
class InMemoryIdempotencyRepository implements IdempotencyRepository {
  readonly rows = new Map<string, MemoryRow>()

  begin(input: IdempotencyBeginInput): Promise<IdempotencyBeginResult> {
    const id = `${input.scope}:${input.key}`
    const row = this.rows.get(id)
    const takeover =
      row !== undefined &&
      (row.expiresAt <= input.now ||
        (row.status === 'processing' &&
          row.lockedUntil <= input.now &&
          row.requestHash === input.requestHash))
    if (row === undefined || takeover) {
      this.rows.set(id, {
        requestHash: input.requestHash,
        status: 'processing',
        response: undefined,
        lockedUntil: input.lockedUntil,
        expiresAt: input.expiresAt,
      })
      return Promise.resolve({ outcome: 'started' })
    }
    if (row.requestHash !== input.requestHash) return Promise.resolve({ outcome: 'mismatch' })
    if (row.status === 'completed' && row.response !== undefined) {
      return Promise.resolve({ outcome: 'replay', response: row.response })
    }
    return Promise.resolve({ outcome: 'in_progress' })
  }

  complete(scope: string, key: string, response: StoredResponse): Promise<void> {
    const row = this.rows.get(`${scope}:${key}`)
    if (row !== undefined) {
      row.status = 'completed'
      row.response = response
    }
    return Promise.resolve()
  }

  release(scope: string, key: string): Promise<void> {
    this.rows.delete(`${scope}:${key}`)
    return Promise.resolve()
  }
}

class FixedClock implements Clock {
  constructor(public current: Date) {}

  now(): Date {
    return this.current
  }
}

class OrdersController {
  @Idempotent('orders')
  create(): void {
    // Solo importa la metadata del decorador.
  }

  list(): void {
    // Ruta sin @Idempotent.
  }
}

/** Respuesta de Express simulada. */
interface FakeResponse {
  statusCode: number
  headers: Record<string, string>
  setHeader(name: string, value: string): void
}

const KEY = '3f2b8c1e-5d4a-4e7b-9a60-1c2d3e4f5a6b'

describe('IdempotencyInterceptor', () => {
  let repository: InMemoryIdempotencyRepository
  let clock: FixedClock
  let interceptor: IdempotencyInterceptor
  let handlerCalls: number

  beforeEach(() => {
    repository = new InMemoryIdempotencyRepository()
    clock = new FixedClock(new Date('2026-11-02T12:00:00.000Z'))
    interceptor = new IdempotencyInterceptor(new Reflector(), repository, clock)
    handlerCalls = 0
  })

  function context(
    headers: Record<string, string>,
    body: unknown,
    // Solo se lee la metadata del método (como hace Nest); no se lo llama.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    handler: () => void = OrdersController.prototype.create,
  ): { ctx: ExecutionContext; res: FakeResponse } {
    const res: FakeResponse = {
      statusCode: 201,
      headers: {},
      setHeader(name, value) {
        this.headers[name.toLowerCase()] = value
      },
    }
    const req = { method: 'POST', originalUrl: '/api/v1/orders', headers, body }
    const ctx = {
      getHandler: () => handler,
      getClass: () => OrdersController,
      switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
    } as unknown as ExecutionContext
    return { ctx, res }
  }

  function handlerReturning(result: () => Observable<unknown>): CallHandler {
    return {
      handle: () => {
        handlerCalls += 1
        return result()
      },
    }
  }

  async function run(
    headers: Record<string, string>,
    body: unknown,
    result: () => Observable<unknown> = () => of({ number: `GLP-${String(handlerCalls)}` }),
  ): Promise<{ value: unknown; res: FakeResponse }> {
    const { ctx, res } = context(headers, body)
    const observable = await interceptor.intercept(ctx, handlerReturning(result))
    return { value: await lastValueFrom(observable), res }
  }

  async function rejection(promise: Promise<unknown>): Promise<HttpException> {
    const error: unknown = await promise.then(
      () => undefined,
      (reason: unknown) => reason,
    )
    if (!(error instanceof HttpException)) throw new Error('Se esperaba una HttpException')
    return error
  }

  it('sin el header Idempotency-Key responde 422 y no ejecuta el handler', async () => {
    const error = await rejection(run({}, { items: [1] }))

    expect(error.getStatus()).toBe(422)
    expect(error.getResponse()).toMatchObject({
      type: 'validation_error',
      errors: [{ field: 'Idempotency-Key', code: 'required' }],
    })
    expect(handlerCalls).toBe(0)
  })

  it('con un Idempotency-Key que no es UUID responde 422', async () => {
    const error = await rejection(run({ 'idempotency-key': 'no-es-uuid' }, { items: [1] }))

    expect(error.getStatus()).toBe(422)
    expect(error.getResponse()).toMatchObject({
      errors: [{ field: 'Idempotency-Key', code: 'invalid_uuid' }],
    })
  })

  it('dos llamadas iguales: la segunda replica la primera sin ejecutar el handler', async () => {
    const first = await run({ 'idempotency-key': KEY }, { items: [1] })
    const second = await run({ 'idempotency-key': KEY }, { items: [1] })

    expect(handlerCalls).toBe(1)
    expect(second.value).toEqual(first.value)
    expect(second.res.headers['idempotent-replayed']).toBe('true')
    expect(first.res.headers['idempotent-replayed']).toBeUndefined()
  })

  it('la misma clave con otro cuerpo responde 422 idempotency_key_reused', async () => {
    await run({ 'idempotency-key': KEY }, { items: [1] })
    const error = await rejection(run({ 'idempotency-key': KEY }, { items: [2] }))

    expect(error.getStatus()).toBe(422)
    expect(error.getResponse()).toMatchObject({ type: 'idempotency_key_reused' })
    expect(handlerCalls).toBe(1)
  })

  it('la misma clave mientras se procesa responde 409 idempotency_in_progress', async () => {
    const pending = new Subject<unknown>()
    const { ctx } = context({ 'idempotency-key': KEY }, { items: [1] })
    const firstObservable = await interceptor.intercept(
      ctx,
      handlerReturning(() => pending),
    )
    const firstResult = lastValueFrom(firstObservable)

    const error = await rejection(run({ 'idempotency-key': KEY }, { items: [1] }))
    pending.next({ number: 'GLP-1' })
    pending.complete()

    expect(error.getStatus()).toBe(409)
    expect(error.getResponse()).toMatchObject({ type: 'idempotency_in_progress' })
    await expect(firstResult).resolves.toEqual({ number: 'GLP-1' })
  })

  it('si el handler falla libera la clave y se puede reintentar', async () => {
    const failure = new Error('falló el handler')
    await expect(
      run({ 'idempotency-key': KEY }, { items: [1] }, () => throwError(() => failure)),
    ).rejects.toBe(failure)

    const retry = await run({ 'idempotency-key': KEY }, { items: [1] })

    expect(handlerCalls).toBe(2)
    expect(retry.value).toEqual({ number: 'GLP-2' })
  })

  it('una clave vencida (24 h) vuelve a ejecutar el handler', async () => {
    await run({ 'idempotency-key': KEY }, { items: [1] })
    clock.current = new Date(clock.current.getTime() + IDEMPOTENCY_KEY_TTL_MS)
    await run({ 'idempotency-key': KEY }, { items: [1] })

    expect(handlerCalls).toBe(2)
  })

  it('guarda el status y el cuerpo de la respuesta y vence a las 24 h', async () => {
    await run({ 'idempotency-key': KEY }, { items: [1] })

    const row = repository.rows.get(`orders:${KEY}`)
    expect(row).toMatchObject({ status: 'completed', response: { status: 201 } })
    expect(row?.expiresAt.toISOString()).toBe('2026-11-03T12:00:00.000Z')
  })

  it('no hace nada en rutas sin @Idempotent', async () => {
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const { ctx } = context({}, {}, OrdersController.prototype.list)
    const observable = await interceptor.intercept(
      ctx,
      handlerReturning(() => of('ok')),
    )

    await expect(lastValueFrom(observable)).resolves.toBe('ok')
    expect(repository.rows.size).toBe(0)
  })

  it('exporta el nombre del header de repetición', () => {
    expect(REPLAYED_HEADER).toBe('Idempotent-Replayed')
  })
})
