import type { INestApplication } from '@nestjs/common'
import type { Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { seed } from '../../prisma/seed'
import { OutboxRelay } from '../../src/shared/infrastructure/outbox/outbox.relay'
import { PrismaService } from '../../src/shared/infrastructure/prisma/prisma.service'
import { createApp } from '../support/app'
import { startContainers, type TestContainers } from '../support/containers'
import {
  call,
  type CallOptions,
  firstError,
  type HttpMethod,
  type Jar,
  newJar,
  refreshCsrf,
  setCookies,
} from '../support/http'
import { RecordingMailPort } from '../support/mail'
import { mateLine, ordersHttp } from '../support/orders-http'

const PASSWORD = 'mate-amargo-2026'

describe('DELETE /me: eliminar la cuenta (HTTP + Postgres + Redis)', () => {
  let containers: TestContainers | undefined
  let app: INestApplication<Server> | undefined
  let yerba = ''
  const mailer = new RecordingMailPort()
  const previousEnv = {
    DATABASE_URL: process.env.DATABASE_URL,
    REDIS_URL: process.env.REDIS_URL,
  }

  beforeAll(async () => {
    containers = await startContainers()
    process.env.DATABASE_URL = containers.databaseUrl
    process.env.REDIS_URL = containers.redisUrl
    app = await createApp({ mailer })
    const relay = app.get(OutboxRelay)
    mailer.pump = () => relay.runOnce()
    await seed(prisma())
    const row = await prisma().product.findUniqueOrThrow({
      where: { slug: 'yerba-canarias-1-kg' },
      select: { id: true },
    })
    yerba = row.id
    await prisma().inventory.update({ where: { productId: yerba }, data: { onHand: 500 } })
  })

  afterAll(async () => {
    await app?.close()
    await containers?.stop()
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) Reflect.deleteProperty(process.env, key)
      else process.env[key] = value
    }
  })

  function server(): Server {
    if (app === undefined) throw new Error('La app no arrancó')
    return app.getHttpServer()
  }

  function prisma(): PrismaService {
    if (app === undefined) throw new Error('La app no arrancó')
    return app.get(PrismaService)
  }

  function send(jar: Jar, method: HttpMethod, path: string, options: CallOptions = {}) {
    return call(server(), jar, method, path, options)
  }

  const { orderBody, createdOrder } = ordersHttp(server)

  /** Cuenta nueva con la sesión iniciada y su CSRF. */
  async function registered(email: string, firstName = 'Ana'): Promise<Jar> {
    const jar = newJar()
    await refreshCsrf(server(), jar)
    const response = await send(jar, 'post', '/auth/register', {
      body: { email, firstName, lastName: 'Pérez', password: PASSWORD },
    })
    expect(response.status, JSON.stringify(response.body)).toBe(201)
    await refreshCsrf(server(), jar)
    return jar
  }

  /** Inicia sesión en otro navegador. */
  async function loggedIn(email: string, password = PASSWORD) {
    const jar = newJar()
    await refreshCsrf(server(), jar)
    const response = await send(jar, 'post', '/auth/login', { body: { email, password } })
    await refreshCsrf(server(), jar)
    return { jar, response }
  }

  it('sin sesión 401 y sin token CSRF 403', async () => {
    const anonymous = newJar()
    await refreshCsrf(server(), anonymous)
    expect((await send(anonymous, 'delete', '/me', { body: { password: PASSWORD } })).status).toBe(
      401,
    )

    const jar = await registered('sin-csrf@ejemplo.com')
    const noCsrf = await send(jar, 'delete', '/me', { body: { password: PASSWORD }, csrf: false })
    expect(noCsrf.status).toBe(403)
    expect((await send(jar, 'get', '/me')).status).toBe(200)
  })

  it('con la contraseña equivocada responde 422 invalid_password y nada cambia', async () => {
    const jar = await registered('equivocada@ejemplo.com')

    const response = await send(jar, 'delete', '/me', { body: { password: 'otra-cosa-1' } })

    expect(response.status).toBe(422)
    expect(firstError(response)).toEqual({
      field: 'password',
      code: 'invalid_password',
      message: 'La contraseña no es correcta',
    })
    expect((await send(jar, 'get', '/me')).status).toBe(200)
    expect(await prisma().user.count({ where: { email: 'equivocada@ejemplo.com' } })).toBe(1)
  })

  it('con la contraseña correcta: 204, cookie borrada, sin login, sin direcciones ni sesiones; el pedido sigue por token', async () => {
    const email = 'borrame@ejemplo.com'
    const jar = await registered(email, 'Marta')
    const customer = await prisma().customer.findFirstOrThrow({
      where: { email, userId: { not: null } },
    })
    await prisma().address.create({
      data: {
        customerId: customer.id,
        label: 'Casa',
        street: 'Av. Corrientes',
        number: '1234',
        postalCode: 'C1043',
        city: 'CABA',
        province: 'caba',
        isDefault: true,
      },
    })
    const { order, orderToken } = await createdOrder(jar, await orderBody([mateLine(yerba)], email))
    expect((await send(jar, 'get', '/me/orders')).body).toMatchObject({ total: 1 })
    const other = await loggedIn(email)
    expect(other.response.status).toBe(200)

    const response = await send(jar, 'delete', '/me', { body: { password: PASSWORD } })

    expect(response.status, JSON.stringify(response.body)).toBe(204)
    expect(setCookies(response).some((cookie) => cookie.endsWith('Max-Age=0'))).toBe(true)
    expect((await send(other.jar, 'get', '/me')).status).toBe(401)
    expect((await loggedIn(email)).response.status).toBe(401)
    expect(await prisma().address.count({ where: { customerId: customer.id } })).toBe(0)
    expect(await prisma().customer.count({ where: { id: customer.id } })).toBe(0)
    expect(await prisma().user.count({ where: { email } })).toBe(0)

    const byToken = await send(newJar(), 'get', `/orders/${order.number}`, {
      headers: { 'X-Order-Token': orderToken },
    })
    expect(byToken.status).toBe(200)
    expect(byToken.body).toMatchObject({ number: order.number, totalArs: order.totalArs })
    expect(
      await prisma().order.findUniqueOrThrow({
        where: { number: order.number },
        select: { customerId: true, contactEmail: true },
      }),
    ).toEqual({ customerId: null, contactEmail: email })

    const mail = await mailer.waitFor('account-deleted', email)
    expect(mail.to).toBe(email)
    expect(mail.text).toContain('Hola, Marta:')

    // Una cuenta nueva con el mismo email arranca sin nada: no vuelve a vincular el pedido.
    const again = await registered(email)
    expect((await send(again, 'get', '/me/orders')).body).toEqual({
      items: [],
      page: 1,
      pageSize: 10,
      total: 0,
    })
  })

  it('diez contraseñas equivocadas seguidas cuentan para el mismo bloqueo que el login', async () => {
    const email = 'bloqueo@ejemplo.com'
    const jar = await registered(email)

    for (let attempt = 1; attempt < 10; attempt += 1) {
      const wrong = await send(jar, 'delete', '/me', { body: { password: 'otra-cosa-1' } })
      expect(wrong.status).toBe(422)
    }
    const tenth = await send(jar, 'delete', '/me', { body: { password: 'otra-cosa-1' } })
    expect(tenth.status).toBe(429)
    expect((await loggedIn(email)).response.status).toBe(429)
    expect((await send(jar, 'delete', '/me', { body: { password: PASSWORD } })).status).toBe(429)
    expect(await prisma().user.count({ where: { email } })).toBe(1)
  })
})
