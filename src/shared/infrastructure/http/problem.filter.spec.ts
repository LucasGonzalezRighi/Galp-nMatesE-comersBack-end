import {
  type ArgumentsHost,
  ConflictException,
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common'
import { ThrottlerException } from '@nestjs/throttler'
import { describe, expect, it, vi } from 'vitest'

import { DomainError } from '../../domain/domain-error'
import { PageQueryDto } from './page.dto'
import { PROBLEM_CONTENT_TYPE, ProblemFilter } from './problem.filter'
import { createValidationPipe } from './validation.pipe'

/** Respuesta de Express simulada: guarda estado, cabeceras y cuerpo. */
interface FakeResponse {
  statusCode: number
  headers: Record<string, string>
  body: unknown
  status(code: number): FakeResponse
  setHeader(name: string, value: string): FakeResponse
  json(body: unknown): FakeResponse
}

function httpHost(method: string, originalUrl: string): { host: ArgumentsHost; res: FakeResponse } {
  const res: FakeResponse = {
    statusCode: 200,
    headers: {},
    body: undefined,
    status(code) {
      this.statusCode = code
      return this
    },
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value
      return this
    },
    json(body) {
      this.body = body
      return this
    },
  }
  const req = { method, originalUrl }
  const host = {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  } as unknown as ArgumentsHost
  return { host, res }
}

function catchWith(
  exception: unknown,
  method = 'GET',
  url = '/api/v1/products/mate-imperial?ref=home',
): { res: FakeResponse; logger: { error: ReturnType<typeof vi.fn> } } {
  const logger = { error: vi.fn() }
  const { host, res } = httpHost(method, url)
  new ProblemFilter(logger).catch(exception, host)
  return { res, logger }
}

describe('ProblemFilter', () => {
  it('convierte un NotFoundException en un 404 problem+json con su mensaje en detail', () => {
    const { res } = catchWith(new NotFoundException('Producto no encontrado'))

    expect(res.statusCode).toBe(404)
    expect(res.headers['content-type']).toBe(PROBLEM_CONTENT_TYPE)
    expect(res.body).toEqual({
      type: 'not_found',
      title: 'No encontrado',
      status: 404,
      detail: 'Producto no encontrado',
      instance: '/api/v1/products/mate-imperial',
    })
  })

  it('usa un detail en español cuando la excepción de Nest no trae mensaje propio', () => {
    const { res } = catchWith(new NotFoundException())

    expect(res.body).toMatchObject({ type: 'not_found', detail: 'No encontramos lo que buscabas.' })
  })

  it('traduce el 404 de una ruta que no existe', () => {
    const { res } = catchWith(
      new NotFoundException('Cannot GET /api/v1/nada'),
      'GET',
      '/api/v1/nada',
    )

    expect(res.statusCode).toBe(404)
    expect(res.body).toMatchObject({
      type: 'not_found',
      detail: 'No existe la ruta GET /api/v1/nada.',
      instance: '/api/v1/nada',
    })
  })

  it('los errores de los body parsers (413, 415) salen con el detail en español (NV-17)', () => {
    for (const [status, message, detail] of [
      [413, 'request entity too large', 'El cuerpo del pedido es demasiado grande.'],
      [415, 'content encoding unsupported', 'El formato del cuerpo del pedido no es soportado.'],
    ] as const) {
      // Así llegan desde Express: Nest envuelve el error de `http-errors` en una HttpException.
      const cause = Object.assign(new Error(message), { statusCode: status, expose: true })
      const { res } = catchWith(new HttpException(message, status, { cause }), 'POST')

      expect(res.statusCode).toBe(status)
      expect(res.body).toMatchObject({ status, detail })
    }
  })

  it('convierte el error del pipe de validación en un 422 con errors[] por campo', async () => {
    const pipe = createValidationPipe()
    const error: unknown = await pipe
      .transform({ page: '0', pageSize: '1000' }, { type: 'query', metatype: PageQueryDto })
      .then(
        () => undefined,
        (rejection: unknown) => rejection,
      )

    const { res } = catchWith(error)

    expect(res.statusCode).toBe(422)
    expect(res.body).toMatchObject({
      type: 'validation_error',
      title: 'Los datos no son válidos',
      status: 422,
      detail: 'Revisá los campos marcados.',
      errors: [
        { field: 'page', code: 'too_small', message: 'La página tiene que ser mayor o igual a 1.' },
        {
          field: 'pageSize',
          code: 'too_big',
          message: 'El tamaño de página tiene que ser menor o igual a 100.',
        },
      ],
    })
  })

  it('rechaza campos que no están en el DTO con un error en español', async () => {
    const pipe = createValidationPipe()
    const error: unknown = await pipe
      .transform({ page: '2', extra: 'x' }, { type: 'query', metatype: PageQueryDto })
      .then(
        () => undefined,
        (rejection: unknown) => rejection,
      )

    const { res } = catchWith(error)

    expect(res.body).toMatchObject({
      status: 422,
      errors: [
        { field: 'extra', code: 'unrecognized_key', message: 'Este campo no está permitido.' },
      ],
    })
  })

  it('convierte el 429 del throttler en rate_limited', () => {
    const { res } = catchWith(new ThrottlerException('Esperá un minuto.'))

    expect(res.statusCode).toBe(429)
    expect(res.body).toMatchObject({
      type: 'rate_limited',
      title: 'Demasiadas solicitudes',
      status: 429,
      detail: 'Esperá un minuto.',
    })
  })

  it('mapea un DomainError con su code, status y detail', () => {
    const { res } = catchWith(
      new DomainError('stock_changed', 409, 'Un producto del carrito ya no tiene stock.'),
    )

    expect(res.statusCode).toBe(409)
    expect(res.body).toEqual({
      type: 'stock_changed',
      title: 'Conflicto',
      status: 409,
      detail: 'Un producto del carrito ya no tiene stock.',
      instance: '/api/v1/products/mate-imperial',
    })
  })

  it('manda Retry-After cuando el DomainError trae retryAfterSeconds', () => {
    const { res } = catchWith(
      new DomainError('rate_limited', 429, 'Demasiados intentos.', undefined, {
        retryAfterSeconds: 30,
      }),
    )

    expect(res.statusCode).toBe(429)
    expect(res.headers['retry-after']).toBe('30')
    expect(res.body).toMatchObject({ type: 'rate_limited', title: 'Demasiadas solicitudes' })
    expect(res.body).not.toHaveProperty('retryAfterSeconds')
  })

  it('manda Retry-After cuando el cuerpo de la HttpException trae retryAfterSeconds', () => {
    const { res } = catchWith(
      new HttpException({ type: 'rate_limited', retryAfterSeconds: 12 }, 429),
    )

    expect(res.headers['retry-after']).toBe('12')
    expect(res.body).not.toHaveProperty('retryAfterSeconds')
  })

  it('no manda Retry-After si no hay retryAfterSeconds o no es un entero positivo', () => {
    const plain = catchWith(new DomainError('stock_changed', 409, 'Sin stock.'))
    const invalid = catchWith(
      new HttpException({ type: 'rate_limited', retryAfterSeconds: -1 }, 429),
    )

    expect(plain.res.headers).not.toHaveProperty('retry-after')
    expect(invalid.res.headers).not.toHaveProperty('retry-after')
  })

  it('no incluye errors fuera de un 422', () => {
    const { res } = catchWith(
      new HttpException(
        { type: 'slug_taken', title: 'El slug ya está en uso', errors: [{ field: 'slug' }] },
        409,
      ),
    )

    expect(res.body).toMatchObject({ type: 'slug_taken', title: 'El slug ya está en uso' })
    expect(res.body).not.toHaveProperty('errors')
  })

  it('manda los changes de un DomainError 409 (stock_changed del contrato)', () => {
    const changes = [
      { kind: 'stock' as const, productId: 'p1', message: 'Quedan 2 unidades de Mate Imperial.' },
    ]
    const { res } = catchWith(
      new DomainError(
        'stock_changed',
        409,
        'El pedido cambió desde que armaste el resumen. Revisalo antes de pagar.',
        'El stock cambió',
        { changes },
      ),
      'POST',
      '/api/v1/orders',
    )

    expect(res.statusCode).toBe(409)
    expect(res.body).toEqual({
      type: 'stock_changed',
      title: 'El stock cambió',
      status: 409,
      detail: 'El pedido cambió desde que armaste el resumen. Revisalo antes de pagar.',
      instance: '/api/v1/orders',
      changes,
    })
  })

  it('respeta los changes del cuerpo de una ConflictException', () => {
    const changes = [
      { kind: 'price', productId: null, message: 'El total cambió de $46.499 a $49.499.' },
    ]
    const { res } = catchWith(
      new ConflictException({ type: 'total_changed', title: 'El total cambió', changes }),
    )

    expect(res.statusCode).toBe(409)
    expect(res.body).toMatchObject({ type: 'total_changed', title: 'El total cambió', changes })
  })

  it('no incluye changes inválidos ni fuera de un 409', () => {
    const invalid = catchWith(
      new ConflictException({ type: 'stock_changed', changes: [{ kind: 'stock' }] }),
    )
    const outside = catchWith(
      new HttpException(
        { type: 'validation_error', changes: [{ kind: 'stock', productId: 'p1', message: 'x' }] },
        422,
      ),
    )

    expect(invalid.res.body).not.toHaveProperty('changes')
    expect(outside.res.body).not.toHaveProperty('changes')
  })

  it('manda los errors de un DomainError 422', () => {
    const errors = [
      {
        field: 'shipping.method',
        code: 'unavailable',
        message: 'Ese método de envío no está disponible.',
      },
    ]
    const { res } = catchWith(
      new DomainError(
        'validation_error',
        422,
        'Ese método de envío ya no está disponible. Volvé al paso de envío y elegí otro.',
        undefined,
        { errors },
      ),
    )

    expect(res.statusCode).toBe(422)
    expect(res.body).toMatchObject({
      type: 'validation_error',
      title: 'Los datos no son válidos',
      errors,
    })
  })

  it('deja pasar el informe 503 de Terminus (/health) con su formato y sin loguear', () => {
    const report = {
      status: 'error',
      info: { redis: { status: 'up' } },
      error: { database: { status: 'down', message: 'Postgres no responde' } },
      details: { database: { status: 'down', message: 'Postgres no responde' } },
    }
    const { res, logger } = catchWith(
      new ServiceUnavailableException(report),
      'GET',
      '/api/v1/health',
    )

    expect(res.statusCode).toBe(503)
    expect(res.body).toEqual(report)
    expect(res.headers['content-type']).toBeUndefined()
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('un error desconocido da 500 genérico y se loguea con el stack', () => {
    const boom = new Error('se rompió la conexión con 10.0.0.5')
    const { res, logger } = catchWith(boom)

    expect(res.statusCode).toBe(500)
    expect(res.body).toMatchObject({
      type: 'server_error',
      title: 'Error del servidor',
      status: 500,
      detail: 'Algo salió mal de nuestro lado. Probá de nuevo en un rato.',
    })
    expect(JSON.stringify(res.body)).not.toContain('10.0.0.5')
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('10.0.0.5'), boom.stack)
  })
})
