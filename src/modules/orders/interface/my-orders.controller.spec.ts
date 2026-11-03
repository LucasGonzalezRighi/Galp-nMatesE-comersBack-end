import type { INestApplication } from '@nestjs/common'
import type { Server } from 'node:http'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { createControllerApp } from '../../../../test/support/controller-app'
import { firstError } from '../../../../test/support/http'
import { InMemorySessionStore } from '../../../../test/support/session'
import { SESSION_PORT, type SessionRecord } from '../../../shared/application/ports/session.port'
import { CUSTOMER_SESSION_COOKIE } from '../../../shared/infrastructure/auth/cookies'
import { GetMyOrderQuery } from '../application/queries/get-my-order.query'
import { ListMyOrdersQuery } from '../application/queries/list-my-orders.query'
import { OrderNotFoundError } from '../domain/orders-errors'
import { MyOrdersController } from './my-orders.controller'

/** Pedido que devuelve el caso de uso simulado (el controlador lo pasa tal cual). */
const ORDER = { number: 'GLP-10001', status: 'pending_payment' }

describe('MyOrdersController (HTTP con casos de uso simulados)', () => {
  const sessions = new InMemorySessionStore()
  const listMyOrders = {
    execute: vi.fn((_customerId: string, page: number) =>
      Promise.resolve({ items: [], page, pageSize: 10, total: 3 }),
    ),
  }
  const getMyOrder = { execute: vi.fn(() => Promise.resolve(ORDER)) }
  let app: INestApplication<Server> | undefined
  let session: SessionRecord

  beforeAll(async () => {
    app = await createControllerApp({
      controllers: [MyOrdersController],
      providers: [
        { provide: SESSION_PORT, useValue: sessions },
        { provide: ListMyOrdersQuery, useValue: listMyOrders },
        { provide: GetMyOrderQuery, useValue: getMyOrder },
      ],
    })
    session = await sessions.create({ kind: 'customer', userId: 'user-1', customerId: 'cus-1' })
  })

  afterAll(async () => {
    await app?.close()
  })

  beforeEach(() => {
    listMyOrders.execute.mockClear()
    getMyOrder.execute.mockClear()
  })

  function read(path: string, withSession = true): request.Test {
    if (app === undefined) throw new Error('La app no arrancó')
    const pending = request(app.getHttpServer()).get(path)
    return withSession ? pending.set('Cookie', `${CUSTOMER_SESSION_COOKIE}=${session.id}`) : pending
  }

  it('GET /me/orders → la página del cliente de la sesión; page se valida', async () => {
    const first = await read('/me/orders')
    const second = await read('/me/orders?page=2')
    const zero = await read('/me/orders?page=0')
    const pageSize = await read('/me/orders?pageSize=5')

    expect(first.status).toBe(200)
    expect(first.body).toEqual({ items: [], page: 1, pageSize: 10, total: 3 })
    expect(second.body).toEqual({ items: [], page: 2, pageSize: 10, total: 3 })
    expect(listMyOrders.execute.mock.calls).toEqual([
      ['cus-1', 1],
      ['cus-1', 2],
    ])
    expect(zero.status).toBe(422)
    expect(firstError(zero)).toMatchObject({ field: 'page', code: 'too_small' })
    expect(pageSize.status).toBe(422)
    expect(firstError(pageSize)).toMatchObject({ field: 'pageSize', code: 'unrecognized_key' })
  })

  it('GET /me/orders/{number} → el pedido del cliente; ajeno → 404; mal formado → 422', async () => {
    const mine = await read('/me/orders/GLP-10001')
    getMyOrder.execute.mockRejectedValueOnce(new OrderNotFoundError())
    const other = await read('/me/orders/GLP-10002')
    const invalid = await read('/me/orders/glp-10001')

    expect(mine.status).toBe(200)
    expect(mine.body).toEqual(ORDER)
    expect(getMyOrder.execute).toHaveBeenCalledWith('cus-1', 'GLP-10001')
    expect(other.status).toBe(404)
    expect(other.body).toMatchObject({ type: 'not_found', detail: 'No encontramos ese pedido.' })
    expect(invalid.status).toBe(422)
    expect(firstError(invalid)).toMatchObject({ field: 'number', code: 'invalid_format' })
  })

  it('sin sesión → 401 en las dos rutas', async () => {
    const list = await read('/me/orders', false)
    const detail = await read('/me/orders/GLP-10001', false)

    expect(list.status).toBe(401)
    expect(detail.status).toBe(401)
    expect(list.body).toMatchObject({ type: 'unauthorized' })
    expect(listMyOrders.execute).not.toHaveBeenCalled()
    expect(getMyOrder.execute).not.toHaveBeenCalled()
  })
})
