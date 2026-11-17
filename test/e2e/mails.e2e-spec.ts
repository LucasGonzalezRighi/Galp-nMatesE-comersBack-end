import { getQueueToken } from '@nestjs/bullmq'
import type { INestApplication } from '@nestjs/common'
import type { Queue } from 'bullmq'
import { randomUUID } from 'node:crypto'
import type { Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { seed } from '../../prisma/seed'
import { SEED_ADMIN } from '../../prisma/seed-data/admin'
import { MailOutboxHandler } from '../../src/modules/notifications/infrastructure/mail.outbox-handler'
import {
  MAIL_QUEUE,
  type MailJobData,
  mailJobId,
} from '../../src/modules/notifications/infrastructure/mail.queue'
import { OutboxRelay } from '../../src/shared/infrastructure/outbox/outbox.relay'
import { PrismaService } from '../../src/shared/infrastructure/prisma/prisma.service'
import { createApp } from '../support/app'
import { startContainers, type TestContainers } from '../support/containers'
import { call, type CallOptions, type HttpMethod, newJar, refreshCsrf } from '../support/http'
import { RecordingMailPort } from '../support/mail'
import { mateLine, ordersHttp } from '../support/orders-http'
import { simToken } from '../support/payments'

/** Pedido creado por HTTP. */
interface PlacedOrder {
  id: string
  number: string
  token: string
  totalArs: number
  email: string
}

describe('mails de la tienda (HTTP + Postgres + Redis, MailPort de prueba)', () => {
  let containers: TestContainers | undefined
  let app: INestApplication<Server> | undefined
  let yerba = ''
  let buyers = 0
  const mailer = new RecordingMailPort()
  const previousEnv = {
    DATABASE_URL: process.env.DATABASE_URL,
    REDIS_URL: process.env.REDIS_URL,
  }
  const admin = newJar()

  beforeAll(async () => {
    containers = await startContainers()
    process.env.DATABASE_URL = containers.databaseUrl
    process.env.REDIS_URL = containers.redisUrl
    app = await createApp({ mailer })
    const relay = app.get(OutboxRelay)
    mailer.pump = () => relay.runOnce()
    await seed(prisma())
    const login = await http('post', '/admin/auth/login', { body: SEED_ADMIN })
    expect(login.status).toBe(200)
    admin.csrf = (login.body as { csrfToken: string }).csrfToken
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

  function mailQueue(): Queue<MailJobData> {
    if (app === undefined) throw new Error('La app no arrancó')
    return app.get<Queue<MailJobData>>(getQueueToken(MAIL_QUEUE))
  }

  /** Pedido como el dashboard (sesión de admin y CSRF). */
  function http(method: HttpMethod, path: string, options: CallOptions = {}) {
    return call(server(), admin, method, path, options)
  }

  /** Pedido de la tienda, sin sesión. */
  function anonymous(method: HttpMethod, path: string, options: CallOptions = {}) {
    return call(server(), newJar(), method, path, options)
  }

  const { orderBody, placeOrder: postOrder } = ordersHttp(server)

  /** Pedido nuevo de invitado, de una yerba. */
  async function placeOrder(): Promise<PlacedOrder> {
    buyers += 1
    const email = `comprador${String(buyers)}@ejemplo.com`
    const body = await orderBody([mateLine(yerba)], email)
    const response = await postOrder(newJar(), {
      ...body,
      customer: { email, firstName: 'Lucía', lastName: 'Pérez', phone: null },
    })
    expect(response.status, JSON.stringify(response.body)).toBe(201)
    const { order, orderToken } = response.body as {
      order: { number: string; totalArs: number }
      orderToken: string
    }
    const row = await prisma().order.findUniqueOrThrow({
      where: { number: order.number },
      select: { id: true },
    })
    return { id: row.id, number: order.number, token: orderToken, totalArs: order.totalArs, email }
  }

  /** Paga el pedido con la tarjeta `APRO` del simulador. */
  async function payByCard(order: PlacedOrder): Promise<void> {
    const response = await anonymous('post', `/orders/${order.number}/payments/mercadopago/card`, {
      headers: { 'X-Order-Token': order.token, 'Idempotency-Key': randomUUID() },
      body: {
        token: simToken('APRO'),
        paymentMethodId: 'visa',
        issuerId: null,
        installments: 1,
        payer: { email: order.email, identification: { type: 'DNI', number: '12.345.678' } },
      },
    })
    expect(response.status, JSON.stringify(response.body)).toBe(200)
  }

  /** `POST /admin/orders/{number}/status`. */
  async function changeStatus(number: string, body: Record<string, unknown>): Promise<void> {
    const response = await http('post', `/admin/orders/${number}/status`, {
      body: { carrier: null, trackingNumber: null, note: null, ...body },
    })
    expect(response.status, JSON.stringify(response.body)).toBe(200)
  }

  /** Total con el formato de la tienda (`$61.999`). */
  function pesos(amount: number): string {
    return `$${new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(amount)}`
  }

  it('un pedido nuevo manda order-received al email del pedido, con el resumen y los enlaces', async () => {
    const order = await placeOrder()

    const mail = await mailer.waitFor('order-received', order.email)

    expect(mail.to).toBe(order.email)
    expect(mail.subject).toBe(`Recibimos tu pedido ${order.number}`)
    expect(mail.text).toContain(pesos(order.totalArs))
    expect(mail.text).toContain('Hola, Lucía:')
    expect(mail.text).toContain('10 días corridos')
    expect(mail.text).toContain('http://localhost:3000/terminos')
    expect(mail.text).toContain('http://localhost:3000/devoluciones')
    expect(mail.html).not.toContain('<img')
    // Review Focus 2: ningún mail del pedido va a otro destinatario.
    expect(mailer.sent.filter((sent) => sent.text.includes(order.number))).toSatisfy(
      (mails: { to: string }[]) => mails.every((sent) => sent.to === order.email),
    )
  })

  it('pagar con el simulador manda payment-approved y despachar, order-shipped con el seguimiento', async () => {
    const order = await placeOrder()
    await payByCard(order)

    const paid = await mailer.waitFor('payment-approved', order.email)
    expect(paid.text).toContain(order.number)

    await changeStatus(order.number, { status: 'preparing' })
    await changeStatus(order.number, {
      status: 'shipped',
      carrier: 'Andreani',
      trackingNumber: 'AND123456789',
    })
    const shipped = await mailer.waitFor('order-shipped', order.email)
    expect(shipped.text).toContain('Empresa: Andreani')
    expect(shipped.text).toContain('Número de seguimiento: AND123456789')
  })

  it('el mismo order.paid entregado otra vez no manda un segundo mail (Review Focus 1)', async () => {
    const order = await placeOrder()
    await payByCard(order)
    await mailer.waitFor('payment-approved', order.email)
    const event = await prisma().outboxEvent.findFirstOrThrow({
      where: { type: 'order.paid', aggregateId: order.number },
    })
    const handler = app?.get(MailOutboxHandler)

    await handler?.handle({
      id: event.id,
      type: event.type,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      occurredAt: event.occurredAt.toISOString(),
      payload: event.payload,
    })
    await new Promise((resolve) => setTimeout(resolve, 1_500))

    expect(mailer.of('payment-approved', order.email)).toHaveLength(1)
    const job = await mailQueue().getJob(mailJobId(event.id, 'payment-approved'))
    expect(await job?.getState()).toBe('completed')
  })

  it('arrepentimiento → withdrawal-code con el código; contacto → contact-received', async () => {
    const withdrawal = await anonymous('post', '/withdrawals', {
      body: {
        name: 'Lucía Gómez',
        email: 'arrepentida@ejemplo.com',
        orderNumber: null,
        comment: null,
        website: '',
      },
    })
    expect(withdrawal.status).toBe(201)
    const { code } = withdrawal.body as { code: string }

    const contact = await anonymous('post', '/contact', {
      body: {
        name: 'Lucía Gómez',
        email: 'consulta@ejemplo.com',
        orderNumber: null,
        reason: 'Envío',
        message: 'Quiero saber si envían a Ushuaia.',
        website: null,
      },
    })
    expect(contact.status).toBe(202)

    const codeMail = await mailer.waitFor('withdrawal-code', 'arrepentida@ejemplo.com')
    expect(codeMail.subject).toContain(code)
    expect(codeMail.text).toContain(code)
    const ack = await mailer.waitFor('contact-received', 'consulta@ejemplo.com')
    expect(ack.text).not.toContain('Ushuaia')
  })

  it('registro → account-created; olvidé mi contraseña → password-reset con el enlace', async () => {
    const browser = newJar()
    await refreshCsrf(server(), browser)
    const register = await call(server(), browser, 'post', '/auth/register', {
      body: {
        email: 'nueva@ejemplo.com',
        firstName: 'Nora',
        lastName: 'Paz',
        password: 'una-clave-larga-2026',
      },
    })
    expect(register.status).toBe(201)
    const welcome = await mailer.waitFor('account-created', 'nueva@ejemplo.com')
    expect(welcome.text).toContain('Hola, Nora:')

    const jar = newJar()
    await refreshCsrf(server(), jar)
    const forgot = await call(server(), jar, 'post', '/auth/password/forgot', {
      body: { email: 'nueva@ejemplo.com' },
    })
    expect(forgot.status).toBe(202)
    const reset = await mailer.waitFor('password-reset', 'nueva@ejemplo.com')
    expect(RecordingMailPort.resetLink(reset)).toMatch(
      /^http:\/\/localhost:3000\/cuenta\/restablecer\?token=rt_[0-9a-f]{64}$/,
    )
    // El enlace no queda en Postgres (no pasa por el outbox) ni en Redis (el job se borra).
    const events = await prisma().outboxEvent.findMany({ select: { payload: true } })
    expect(JSON.stringify(events)).not.toContain('rt_')
    const finished = await mailQueue().getJobs(['completed'])
    expect(finished.some((job) => job.data.kind === 'direct')).toBe(false)
  })

  it('con el servidor de mails rechazando, la compra responde igual y el mail se reintenta (Review Focus 3)', async () => {
    mailer.failWith = new Error('421 smtp caído')
    const attemptsBefore = mailer.attempts
    try {
      const order = await placeOrder()
      await payByCard(order)
      const deadline = Date.now() + 15_000
      while (mailer.attempts < attemptsBefore + 2 && Date.now() < deadline) {
        await mailer.pump?.()
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      expect(mailer.attempts).toBeGreaterThanOrEqual(attemptsBefore + 2)
      const event = await prisma().outboxEvent.findFirstOrThrow({
        where: { type: 'order.created', aggregateId: order.number },
      })
      const job = await mailQueue().getJob(mailJobId(event.id, 'order-received'))
      expect(await job?.getState()).toBe('delayed')
      expect(mailer.of('order-received', order.email)).toHaveLength(0)

      mailer.failWith = null
      const mail = await mailer.waitFor('order-received', order.email, 20_000)
      expect(mail.to).toBe(order.email)
    } finally {
      mailer.failWith = null
    }
  })
})
