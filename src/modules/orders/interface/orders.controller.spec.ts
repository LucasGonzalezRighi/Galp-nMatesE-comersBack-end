import type { INestApplication } from '@nestjs/common'
import { APP_INTERCEPTOR } from '@nestjs/core'
import type { Server } from 'node:http'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { createControllerApp } from '../../../../test/support/controller-app'
import { firstError } from '../../../../test/support/http'
import { FixedClock } from '../../../../test/support/identity'
import { InMemorySessionStore } from '../../../../test/support/session'
import { SESSION_PORT, type SessionRecord } from '../../../shared/application/ports/session.port'
import { CLOCK } from '../../../shared/domain/clock'
import { DomainError } from '../../../shared/domain/domain-error'
import { CUSTOMER_SESSION_COOKIE } from '../../../shared/infrastructure/auth/cookies'
import { IdempotencyInterceptor } from '../../../shared/infrastructure/idempotency/idempotency.interceptor'
import {
  IDEMPOTENCY_REPOSITORY,
  type IdempotencyRepository,
} from '../../../shared/infrastructure/idempotency/idempotency.repository'
import { CreateOrderCommand } from '../application/commands/create-order.command'
import { GetOrderQuery } from '../application/queries/get-order.query'
import { OrderConflictError, OrderNotFoundError } from '../domain/orders-errors'
import { OrdersController } from './orders.controller'

const KEY = '3f2b8c1e-5d4a-4e7b-9a60-1c2d3e4f5a6b'

/** Dirección de domicilio completa. */
const HOME_ADDRESS = {
  street: 'Av. Corrientes',
  number: '1234',
  apartment: null,
  postalCode: 'C1043',
  city: 'CABA',
  province: 'CABA',
}

/** Cuerpo de `POST /orders` como lo arma el checkout. */
const BODY = {
  customer: {
    email: ' Lucia@Ejemplo.com ',
    firstName: 'Lucía',
    lastName: 'Pérez',
    phone: '1123456789',
  },
  shipping: { method: 'home', address: { ...HOME_ADDRESS, postalCode: 'c1043' } },
  items: [
    {
      type: 'product',
      productId: 'prd-imperial-premium',
      quantity: 1,
      options: { leather: 'Negro', ferrule: 'Alpaca cincelada' },
      expectedUnitPriceArs: 39999,
    },
  ],
  paymentMethod: 'mp_redirect',
  expectedTotalArs: 46499,
  website: '',
}

/** Respuesta del caso de uso simulado (el controlador la pasa tal cual). */
const RESULT = { order: { number: 'GLP-10001' }, orderToken: `ot_${'a'.repeat(64)}` }

/** Repositorio de idempotencia que siempre deja empezar (cada test usa su propia clave). */
const idempotency: IdempotencyRepository = {
  begin: () => Promise.resolve({ outcome: 'started' }),
  complete: () => Promise.resolve(),
  release: () => Promise.resolve(),
}

describe('OrdersController (HTTP con casos de uso simulados)', () => {
  const sessions = new InMemorySessionStore()
  const createOrder = { execute: vi.fn(() => Promise.resolve(RESULT)) }
  const getOrder = { execute: vi.fn(() => Promise.resolve(RESULT.order)) }
  let app: INestApplication<Server> | undefined
  let customer: SessionRecord

  beforeAll(async () => {
    app = await createControllerApp({
      controllers: [OrdersController],
      providers: [
        { provide: SESSION_PORT, useValue: sessions },
        { provide: IDEMPOTENCY_REPOSITORY, useValue: idempotency },
        { provide: CLOCK, useValue: new FixedClock() },
        { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
        { provide: CreateOrderCommand, useValue: createOrder },
        { provide: GetOrderQuery, useValue: getOrder },
      ],
    })
    customer = await sessions.create({ kind: 'customer', userId: 'user-1', customerId: 'cus-1' })
  })

  afterAll(async () => {
    await app?.close()
  })

  beforeEach(() => {
    createOrder.execute.mockClear()
    getOrder.execute.mockClear()
    sessions.failWith = undefined
  })

  function server(): Server {
    if (app === undefined) throw new Error('La app no arrancó')
    return app.getHttpServer()
  }

  function create(body: unknown, key: string | null = KEY): request.Test {
    const pending = request(server())
      .post('/orders')
      .send(body as object)
    return key === null ? pending : pending.set('Idempotency-Key', key)
  }

  it('POST /orders → 201 con el pedido; normaliza el contacto y pasa los null explícitos', async () => {
    const response = await create({
      ...BODY,
      customer: { ...BODY.customer, phone: '' },
      shipping: {
        method: 'branch',
        address: { postalCode: '8300', city: 'Neuquén', province: 'Neuquén' },
      },
    }).set('X-CSRF-Token', 'token-viejo')

    expect(response.status).toBe(201)
    expect(response.body).toEqual(RESULT)
    expect(createOrder.execute).toHaveBeenCalledWith(
      {
        customer: {
          email: 'lucia@ejemplo.com',
          firstName: 'Lucía',
          lastName: 'Pérez',
          phone: null,
        },
        shipping: {
          method: 'branch',
          address: { postalCode: '8300', city: 'Neuquén', province: 'Neuquén' },
        },
        items: BODY.items,
        paymentMethod: 'mp_redirect',
        expectedTotalArs: 46499,
        website: '',
      },
      { customerId: null },
    )
  })

  it('POST /orders: el piso vacío, el honeypot ausente y el retiro quedan en null', async () => {
    const withoutWebsite = Object.fromEntries(
      Object.entries(BODY).filter(([key]) => key !== 'website'),
    )
    const home = await create({
      ...withoutWebsite,
      shipping: { method: 'home', address: { ...HOME_ADDRESS, apartment: '   ' } },
    })
    const pickup = await create({ ...BODY, shipping: { method: 'pickup', address: HOME_ADDRESS } })

    expect(home.status).toBe(201)
    expect(pickup.status).toBe(201)
    expect(createOrder.execute).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        shipping: { method: 'home', address: HOME_ADDRESS },
        website: null,
      }),
      { customerId: null },
    )
    expect(createOrder.execute).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ shipping: { method: 'pickup', address: null } }),
      { customerId: null },
    )
  })

  it('POST /orders con la cookie de un cliente → el pedido es de su cuenta', async () => {
    const response = await create(BODY).set('Cookie', `${CUSTOMER_SESSION_COOKIE}=${customer.id}`)

    expect(response.status).toBe(201)
    expect(createOrder.execute).toHaveBeenCalledWith(expect.anything(), { customerId: 'cus-1' })
  })

  it.each([
    ['sin Idempotency-Key', BODY, null, { field: 'Idempotency-Key', code: 'required' }],
    [
      'email inválido',
      { ...BODY, customer: { ...BODY.customer, email: 'vos@' } },
      KEY,
      { field: 'customer.email', code: 'invalid_email', message: 'Ingresá un email válido' },
    ],
    [
      'domicilio sin calle',
      { ...BODY, shipping: { method: 'home', address: { ...HOME_ADDRESS, street: undefined } } },
      KEY,
      { field: 'shipping.address.street', code: 'invalid_type', message: 'Requerido' },
    ],
    [
      'sucursal con calle',
      {
        ...BODY,
        shipping: { method: 'branch', address: { ...HOME_ADDRESS, apartment: undefined } },
      },
      KEY,
      {
        field: 'shipping.address.street',
        code: 'unrecognized_key',
        message: 'Este campo no está permitido.',
      },
    ],
    [
      'domicilio sin dirección',
      { ...BODY, shipping: { method: 'home', address: null } },
      KEY,
      { field: 'shipping.address.street', code: 'invalid_type', message: 'Requerido' },
    ],
    [
      'forma de pago que no existe',
      { ...BODY, paymentMethod: 'efectivo' },
      KEY,
      { field: 'paymentMethod', code: 'invalid_value', message: 'Elegí una forma de pago.' },
    ],
    [
      'total esperado como texto',
      { ...BODY, expectedTotalArs: '46499' },
      KEY,
      {
        field: 'expectedTotalArs',
        code: 'invalid_type',
        message: 'El total esperado tiene que ser un número entero.',
      },
    ],
  ])('POST /orders %s → 422 con el campo exacto', async (_name, body, key, expected) => {
    const response = await create(body, key)

    expect(response.status).toBe(422)
    expect(firstError(response)).toMatchObject(expected)
    expect(createOrder.execute).not.toHaveBeenCalled()
  })

  it('POST /orders: el 409 del caso de uso sale con sus changes tal cual', async () => {
    const changes = [
      { kind: 'stock', productId: 'prd-coquito', message: 'Mate Coquito Criollo se agotó.' },
    ] as const
    createOrder.execute.mockRejectedValueOnce(new OrderConflictError('stock_changed', changes))

    const response = await create(BODY)

    expect(response.status).toBe(409)
    expect(response.body).toEqual({
      type: 'stock_changed',
      title: 'El stock cambió',
      status: 409,
      detail: 'El pedido cambió desde que armaste el resumen. Revisalo antes de pagar.',
      instance: '/orders',
      changes,
    })
  })

  it('POST /orders con cookie y Redis caído → 503', async () => {
    sessions.failWith = () => new DomainError('service_unavailable', 503, 'Redis no responde.')

    const response = await create(BODY).set('Cookie', `${CUSTOMER_SESSION_COOKIE}=${customer.id}`)

    expect(response.status).toBe(503)
    expect(createOrder.execute).not.toHaveBeenCalled()
  })

  it('GET /orders/{number} pasa el token y la sesión al caso de uso', async () => {
    const byToken = await request(server())
      .get('/orders/GLP-10001')
      .set('X-Order-Token', RESULT.orderToken)
    const bySession = await request(server())
      .get('/orders/GLP-10001')
      .set('Cookie', `${CUSTOMER_SESSION_COOKIE}=${customer.id}`)

    expect(byToken.status).toBe(200)
    expect(byToken.body).toEqual(RESULT.order)
    expect(bySession.status).toBe(200)
    expect(getOrder.execute).toHaveBeenNthCalledWith(1, 'GLP-10001', {
      token: RESULT.orderToken,
      customerId: null,
    })
    expect(getOrder.execute).toHaveBeenNthCalledWith(2, 'GLP-10001', {
      token: null,
      customerId: 'cus-1',
    })
  })

  it('GET /orders/{number} de otro o inexistente → 404 sin datos', async () => {
    getOrder.execute.mockRejectedValueOnce(new OrderNotFoundError())

    const response = await request(server()).get('/orders/GLP-10001')

    expect(response.status).toBe(404)
    expect(response.body).toEqual({
      type: 'not_found',
      title: 'No encontrado',
      status: 404,
      detail: 'No encontramos ese pedido.',
      instance: '/orders/GLP-10001',
    })
  })

  it('GET /orders/{number} con un número mal formado → 422 en number', async () => {
    const response = await request(server()).get('/orders/GLP-123')

    expect(response.status).toBe(422)
    expect(firstError(response)).toEqual({
      field: 'number',
      code: 'invalid_format',
      message: 'El número de pedido tiene que ser GLP- y cinco dígitos.',
    })
    expect(getOrder.execute).not.toHaveBeenCalled()
  })
})
