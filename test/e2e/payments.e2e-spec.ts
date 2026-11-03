import type { INestApplication } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import type { Server } from 'node:http'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { seed } from '../../prisma/seed'
import { ENV, type Env } from '../../src/config/env'
import {
  ORDER_PAYMENTS_PORT,
  type OrderPaymentsPort,
} from '../../src/modules/orders/application/ports/order-payments.port'
import type { OrderView } from '../../src/modules/orders/application/read-models'
import {
  PAYMENT_GATEWAY_PORT,
  type PaymentGatewayPort,
} from '../../src/modules/payments/application/ports/payment-gateway.port'
import {
  PAYMENT_REPOSITORY,
  type PaymentRepository,
} from '../../src/modules/payments/application/ports/payment.repository.port'
import { PaymentGatewayError } from '../../src/modules/payments/domain/payments-errors'
import type { ProviderPayment } from '../../src/modules/payments/domain/provider-payment'
import { EnvPaymentsSettings } from '../../src/modules/payments/infrastructure/env-payments-settings.adapter'
import { PaymentsSweep } from '../../src/modules/payments/infrastructure/payments-sweep'
import { SimulatedGateway } from '../../src/modules/payments/infrastructure/simulated.gateway'
import { PrismaService } from '../../src/shared/infrastructure/prisma/prisma.service'
import { createApp } from '../support/app'
import { startContainers, type TestContainers } from '../support/containers'
import { call, type CallOptions, type HttpMethod, newJar } from '../support/http'
import { mateLine, ordersHttp } from '../support/orders-http'
import { signWebhook, simToken, WEBHOOK_SECRET } from '../support/payments'

/** Las cuatro rutas de pago del contrato. */
type PaymentRoute = 'preference' | 'card' | 'installments' | 'cancel'

/** Pedido creado por HTTP, con lo que usan los casos. */
interface PlacedOrder {
  id: string
  number: string
  token: string
}

/** Treinta minutos, en milisegundos. */
const RESERVATION_MS = 30 * 60_000

/** Un minuto, en milisegundos. */
const MINUTE = 60_000

/** Total de un pedido de una yerba (9999) con envío a domicilio (6500). */
const ORDER_TOTAL = 16_499

/** Espera de las colas: el worker toma el job en milisegundos, pero Docker puede ir lento. */
const QUEUE_WAIT = { timeout: 15_000, interval: 200 } as const

/** `x-request-id` de las notificaciones. */
const REQUEST_ID = '4a1b9d7e-6f3c-4b0a-8c52-9d1e7f2a3b4c'

describe('pagos por HTTP (Postgres + Redis + BullMQ, pasarela simulada)', () => {
  let containers: TestContainers | undefined
  let app: INestApplication<Server> | undefined
  let yerba = ''
  let customers = 0
  const previousEnv = {
    DATABASE_URL: process.env.DATABASE_URL,
    REDIS_URL: process.env.REDIS_URL,
    MP_WEBHOOK_SECRET: process.env.MP_WEBHOOK_SECRET,
  }

  beforeAll(async () => {
    containers = await startContainers()
    process.env.DATABASE_URL = containers.databaseUrl
    process.env.REDIS_URL = containers.redisUrl
    // El secreto se lee al armar la app: sin él, toda notificación da 401.
    process.env.MP_WEBHOOK_SECRET = WEBHOOK_SECRET
    app = await createApp()
    await app.listen(0, '127.0.0.1')
    await seed(prisma())
    const row = await prisma().product.findUniqueOrThrow({
      where: { slug: 'yerba-canarias-1-kg' },
      select: { id: true },
    })
    yerba = row.id
    // Muchos pedidos de una yerba: stock de sobra antes de la primera cotización.
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

  /** Las escrituras de pagos sobre pedidos de la app (`markPaid`…). */
  function orderPayments(): OrderPaymentsPort {
    if (app === undefined) throw new Error('La app no arrancó')
    return app.get<OrderPaymentsPort>(ORDER_PAYMENTS_PORT)
  }

  /** Los intentos de pago de la app. */
  function payments(): PaymentRepository {
    if (app === undefined) throw new Error('La app no arrancó')
    return app.get<PaymentRepository>(PAYMENT_REPOSITORY)
  }

  /** La pasarela de la app: sin `MP_*` es la simulada. */
  function gateway(): SimulatedGateway {
    const value = app?.get<PaymentGatewayPort>(PAYMENT_GATEWAY_PORT)
    if (!(value instanceof SimulatedGateway)) throw new Error('La pasarela no es la simulada')
    return value
  }

  function storeOrigin(): string {
    if (app === undefined) throw new Error('La app no arrancó')
    return app.get<Env>(ENV).STORE_ORIGIN
  }

  /** Origen de las páginas del simulador (`PUBLIC_API_ORIGIN` o `http://localhost:${PORT}`). */
  function simulatorOrigin(): string {
    if (app === undefined) throw new Error('La app no arrancó')
    return app.get(EnvPaymentsSettings).simulatorOrigin
  }

  function send(method: HttpMethod, path: string, options?: CallOptions) {
    return call(server(), newJar(), method, path, options)
  }

  const { orderBody, createdOrder } = ordersHttp(server)

  /** Pedido nuevo de una yerba, con su token. */
  async function placeOrder(): Promise<PlacedOrder> {
    customers += 1
    const { order, orderToken } = await createdOrder(
      newJar(),
      await orderBody([mateLine(yerba)], `pago${String(customers)}@ejemplo.com`),
    )
    expect(order.totalArs).toBe(ORDER_TOTAL)
    const row = await prisma().order.findUniqueOrThrow({
      where: { number: order.number },
      select: { id: true },
    })
    return { id: row.id, number: order.number, token: orderToken }
  }

  /** Cuerpo de `POST …/card` con un token simulado del titular. */
  function cardBody(holder: string, installments = 1): Record<string, unknown> {
    return {
      token: simToken(holder),
      paymentMethodId: 'visa',
      issuerId: null,
      installments,
      payer: { email: 'lucia@ejemplo.com', identification: { type: 'DNI', number: '12.345.678' } },
    }
  }

  /** Pega a una ruta de pago con el token dado (o sin token) y una clave nueva si hace falta. */
  function pay(
    route: PaymentRoute,
    number: string,
    token: string | null,
    options: { body?: unknown; key?: string } = {},
  ) {
    const headers: Record<string, string> = {}
    if (token !== null) headers['X-Order-Token'] = token
    if (route === 'preference' || route === 'card') {
      headers['Idempotency-Key'] = options.key ?? randomUUID()
    }
    const body =
      options.body ??
      (route === 'installments' ? { bin: '45031234', paymentTypeId: 'credit_card' } : undefined)
    const path =
      route === 'cancel'
        ? `/orders/${number}/cancel-payment`
        : `/orders/${number}/payments/mercadopago/${route}`
    return send('post', path, body === undefined ? { headers } : { headers, body })
  }

  async function readOrder(order: PlacedOrder): Promise<OrderView> {
    const response = await send('get', `/orders/${order.number}`, {
      headers: { 'X-Order-Token': order.token },
    })
    expect(response.status).toBe(200)
    return response.body as OrderView
  }

  /** Mueve la reserva del pedido al pasado: vence hace `minutesAgo` minutos. */
  async function reservationEndedAgo(order: PlacedOrder, minutesAgo: number): Promise<void> {
    const reservedUntil = new Date(Date.now() - minutesAgo * MINUTE)
    const createdAt = new Date(reservedUntil.getTime() - RESERVATION_MS)
    await prisma().order.update({
      where: { id: order.id },
      data: { createdAt, placedAt: createdAt, reservedUntil },
    })
    await prisma().orderStatusHistory.updateMany({
      where: { orderId: order.id },
      data: { createdAt },
    })
  }

  /** Ruta relativa a `/api/v1` de una URL absoluta del simulador. */
  function simulatorPath(url: string): string {
    const parsed = new URL(url)
    return `${parsed.pathname.replace(/^\/api\/v1/, '')}${parsed.search}`
  }

  /** Lo que el simulador "tiene" en Mercado Pago para un pago, con cambios. */
  function providerPayment(
    order: PlacedOrder,
    changes: Partial<ProviderPayment> = {},
  ): ProviderPayment {
    return {
      providerPaymentId: String(9_000_000_000 + Math.floor(Math.random() * 900_000_000)),
      status: 'approved',
      statusDetail: 'accredited',
      amountArs: ORDER_TOTAL,
      refundedArs: 0,
      installments: 1,
      paymentTypeId: 'account_money',
      paymentMethodId: 'account_money',
      cardLastFour: null,
      issuerId: null,
      externalReference: order.number,
      challengeUrl: null,
      approvedAt: changes.status === 'approved' || changes.status === undefined ? new Date() : null,
      ...changes,
    }
  }

  /** Manda una notificación firmada con `MP_WEBHOOK_SECRET` (o la firma dada). */
  function notify(
    dataId: string,
    eventId: string,
    signature = signWebhook({ dataId, requestId: REQUEST_ID }),
  ) {
    return send('post', `/webhooks/mercadopago?data.id=${dataId}&type=payment`, {
      headers: { 'x-signature': signature, 'x-request-id': REQUEST_ID },
      body: {
        id: eventId,
        type: 'payment',
        action: 'payment.updated',
        live_mode: false,
        user_id: 123456,
        data: { id: dataId },
      },
    })
  }

  /** Espera a que el worker procese la notificación y devuelve su fila. */
  async function processedEvent(eventId: string) {
    return vi.waitFor(async () => {
      const row = await prisma().webhookEvent.findFirstOrThrow({ where: { eventId } })
      expect(row.processedAt).not.toBeNull()
      return row
    }, QUEUE_WAIT)
  }

  async function stockOf(productId: string) {
    const row = await prisma().inventory.findUniqueOrThrow({ where: { productId } })
    return { onHand: row.onHand, reserved: row.reserved }
  }

  describe('Checkout Pro con el simulador del back', () => {
    it('preferencia → initPoint del simulador; la página muestra número y total; Aprobar → 302 a la tienda y el pedido pagado', async () => {
      const order = await placeOrder()

      const preference = await pay('preference', order.number, order.token)
      expect(preference.status).toBe(200)
      const { initPoint } = preference.body as { initPoint: string }
      expect(
        initPoint.startsWith(`${simulatorOrigin()}/api/v1/__simulated/mercadopago/checkout?`),
      ).toBe(true)
      expect(new URL(initPoint).searchParams.get('preference')).toMatch(/^sim-pref-[0-9a-f-]{36}$/)

      const page = await send('get', simulatorPath(initPoint))
      expect(page.status).toBe(200)
      expect(page.headers['content-type']).toContain('text/html')
      expect(page.text).toContain(order.number)
      expect(page.text).toContain('$16.499')

      const preferenceId = new URL(initPoint).searchParams.get('preference') ?? ''
      const resolved = await request(server())
        .post('/api/v1/__simulated/mercadopago/resolve')
        .type('form')
        .send({ preference: preferenceId, result: 'approved' })
      expect(resolved.status).toBe(302)
      expect(resolved.headers.location).toBe(
        `${storeOrigin()}/checkout/resultado?pedido=${order.number}`,
      )

      const view = await readOrder(order)
      expect(view.status).toBe('paid')
      expect(view.paymentStatus).toBe('approved')
      expect(view.payment).toMatchObject({
        method: 'mp_redirect',
        statusDetail: 'accredited',
        challenge: null,
      })
      expect(view.payment.mpPaymentId).toMatch(/^\d{10}$/)
      expect(view.history.map((entry) => entry.status)).toEqual(['pending_payment', 'paid'])
    })

    it('la misma Idempotency-Key devuelve la misma preferencia (Idempotent-Replayed) sin otro intento', async () => {
      const order = await placeOrder()
      const key = randomUUID()

      const first = await pay('preference', order.number, order.token, { key })
      const second = await pay('preference', order.number, order.token, { key })

      expect(first.status).toBe(200)
      expect(second.status).toBe(200)
      expect(second.body).toEqual(first.body)
      expect(second.headers['idempotent-replayed']).toBe('true')
      expect(await prisma().payment.count({ where: { orderId: order.id } })).toBe(1)
    })

    it('502 de la pasarela en la preferencia → el reintento con la misma clave crea otra, sin 500', async () => {
      const order = await placeOrder()
      const key = randomUUID()
      const failure = vi
        .spyOn(gateway(), 'createPreference')
        .mockRejectedValueOnce(new PaymentGatewayError())
      try {
        const failed = await pay('preference', order.number, order.token, { key })
        const retry = await pay('preference', order.number, order.token, { key })

        expect(failed.status).toBe(502)
        expect(retry.status).toBe(200)
        expect(retry.body).toMatchObject({ initPoint: expect.any(String) as string })
      } finally {
        failure.mockRestore()
      }

      const attempts = await prisma().payment.findMany({
        where: { orderId: order.id },
        orderBy: { createdAt: 'asc' },
      })
      expect(attempts.map((attempt) => [attempt.status, attempt.isActive])).toEqual([
        ['cancelled', false],
        ['none', true],
      ])
    })

    it('cancel-payment → 204 y paymentStatus cancelled; repetido → 204; la preferencia ya no se puede resolver', async () => {
      const order = await placeOrder()
      const preference = await pay('preference', order.number, order.token)
      const preferenceId =
        new URL((preference.body as { initPoint: string }).initPoint).searchParams.get(
          'preference',
        ) ?? ''

      const first = await pay('cancel', order.number, order.token)
      const again = await pay('cancel', order.number, order.token)
      const resolved = await send('post', '/__simulated/mercadopago/resolve', {
        body: { preference: preferenceId, result: 'approved' },
      })

      expect(first.status).toBe(204)
      expect(again.status).toBe(204)
      const view = await readOrder(order)
      expect(view.status).toBe('pending_payment')
      expect(view.paymentStatus).toBe('cancelled')
      expect(resolved.status).toBe(409)
      expect(resolved.body).toMatchObject({ type: 'intent_not_active' })
    })
  })

  describe('tarjeta con el simulador', () => {
    it('APRO → 200 approved y GET /orders pagado con lastFour, installments y mpPaymentId', async () => {
      const order = await placeOrder()

      const response = await pay('card', order.number, order.token, { body: cardBody('APRO', 3) })

      expect(response.status).toBe(200)
      expect(response.body).toEqual({
        paymentStatus: 'approved',
        statusDetail: 'accredited',
        challenge: null,
      })
      const view = await readOrder(order)
      expect(view.status).toBe('paid')
      expect(view.paymentStatus).toBe('approved')
      expect(view.payment).toEqual({
        method: 'card',
        installments: 3,
        paymentTypeId: 'credit_card',
        lastFour: '3704',
        statusDetail: 'accredited',
        mpPaymentId: expect.stringMatching(/^\d{10}$/) as string,
        challenge: null,
      })
    })

    it('replay del cobro: mismo cuerpo e Idempotent-Replayed; la clave con otro cuerpo → 422', async () => {
      const order = await placeOrder()
      const key = randomUUID()
      const body = cardBody('CONT')

      const first = await pay('card', order.number, order.token, { key, body })
      const replay = await pay('card', order.number, order.token, { key, body })
      const reused = await pay('card', order.number, order.token, {
        key,
        body: { ...body, installments: 3 },
      })

      expect(first.status).toBe(200)
      expect(replay.status).toBe(200)
      expect(replay.body).toEqual(first.body)
      expect(replay.headers['idempotent-replayed']).toBe('true')
      expect(reused.status).toBe(422)
      expect(reused.body).toMatchObject({
        type: 'idempotency_key_reused',
        title: 'La clave ya se usó',
      })
      expect(await prisma().payment.count({ where: { orderId: order.id } })).toBe(1)
    })

    it('cuotas que no se ofrecen → 422; con la misma clave y el mismo cuerpo otra vez 422 (nunca 500) y el CONT activo sigue pendiente', async () => {
      const order = await placeOrder()
      const pending = await pay('card', order.number, order.token, { body: cardBody('CONT') })
      expect(pending.status).toBe(200)
      const key = randomUUID()
      const body = cardBody('APRO', 4)

      const first = await pay('card', order.number, order.token, { key, body })
      const again = await pay('card', order.number, order.token, { key, body })

      for (const response of [first, again]) {
        expect(response.status).toBe(422)
        expect(response.body).toMatchObject({
          type: 'validation_error',
          errors: [{ field: 'installments', code: 'invalid_value' }],
        })
      }
      const attempts = await prisma().payment.findMany({ where: { orderId: order.id } })
      expect(attempts.map((attempt) => [attempt.status, attempt.isActive])).toEqual([
        ['pending', true],
      ])
      expect((await readOrder(order)).paymentStatus).toBe('pending')
    })

    it('502 de la pasarela → el intento queda cancelled con la clave suelta y el reintento con la misma clave cobra (antes daba 500)', async () => {
      const order = await placeOrder()
      const key = randomUUID()
      const body = cardBody('APRO')
      const failure = vi
        .spyOn(gateway(), 'createCardPayment')
        .mockRejectedValueOnce(new PaymentGatewayError())
      try {
        const failed = await pay('card', order.number, order.token, { key, body })
        const retry = await pay('card', order.number, order.token, { key, body })

        expect(failed.status).toBe(502)
        expect(failed.body).toMatchObject({ type: 'payment_gateway_error' })
        expect(retry.status).toBe(200)
        expect(retry.body).toMatchObject({ paymentStatus: 'approved' })
      } finally {
        failure.mockRestore()
      }

      const attempts = await prisma().payment.findMany({
        where: { orderId: order.id },
        orderBy: { createdAt: 'asc' },
      })
      expect(
        attempts.map((attempt) => [attempt.status, attempt.isActive, attempt.idempotencyKey]),
      ).toEqual([
        ['cancelled', false, `${key}:released:${String(attempts[0]?.id)}`],
        ['approved', false, key],
      ])
      expect((await readOrder(order)).status).toBe('paid')
    })

    it.each([
      ['pagar el pedido con el aprobado ya guardado', 'markPaid'],
      ['guardar el pago en el intento', 'update'],
    ] as const)(
      'el cobro sale pero falla %s → 500; el reintento con la misma clave y el mismo cuerpo retoma el intento: 200 approved, un solo cobro y el pedido pagado',
      async (_case, failing) => {
        const order = await placeOrder()
        const key = randomUUID()
        const body = cardBody('APRO')
        const failure =
          failing === 'markPaid'
            ? vi
                .spyOn(orderPayments(), 'markPaid')
                .mockRejectedValueOnce(new Error('Se cayó la base al pagar el pedido'))
            : vi
                .spyOn(payments(), 'update')
                .mockRejectedValueOnce(new Error('Se cayó la base al guardar el pago'))
        // Envuelve a la pasarela simulada para anotar qué pago devolvió cada cobro.
        const simulated = gateway()
        const charge = simulated.createCardPayment.bind(simulated)
        const charged: string[] = []
        const charges = vi
          .spyOn(simulated, 'createCardPayment')
          .mockImplementation(async (input) => {
            const payment = await charge(input)
            charged.push(payment.providerPaymentId)
            return payment
          })
        try {
          const failed = await pay('card', order.number, order.token, { key, body })
          const retry = await pay('card', order.number, order.token, { key, body })

          expect(failed.status).toBe(500)
          expect(retry.status).toBe(200)
          expect(retry.body).toMatchObject({ paymentStatus: 'approved' })
        } finally {
          failure.mockRestore()
          charges.mockRestore()
        }

        const attempts = await prisma().payment.findMany({ where: { orderId: order.id } })
        expect(attempts.map((attempt) => [attempt.status, attempt.idempotencyKey])).toEqual([
          ['approved', key],
        ])
        // Un solo cobro: cada cobro con la clave devolvió el mismo pago, el que quedó en el intento.
        expect(charged.length).toBeGreaterThanOrEqual(1)
        expect(new Set(charged)).toEqual(new Set([attempts[0]?.providerPaymentId]))
        expect(await prisma().refund.count({ where: { payment: { orderId: order.id } } })).toBe(0)
        const view = await readOrder(order)
        expect(view.status).toBe('paid')
        expect(view.paymentStatus).toBe('approved')
      },
    )

    it('CONT → pending; vencida la reserva, el barrido concilia pero no lo vence', async () => {
      const order = await placeOrder()

      const response = await pay('card', order.number, order.token, { body: cardBody('CONT') })
      await reservationEndedAgo(order, 15)
      await app?.get(PaymentsSweep).runOnce()

      expect(response.status).toBe(200)
      expect(response.body).toEqual({
        paymentStatus: 'pending',
        statusDetail: 'pending_contingency',
        challenge: null,
      })
      const view = await readOrder(order)
      expect(view.status).toBe('pending_payment')
      expect(view.paymentStatus).toBe('pending')
    })

    it('3DS → action_required con challenge.url en la respuesta y en el pedido; Confirmar → pagado', async () => {
      const order = await placeOrder()

      const response = await pay('card', order.number, order.token, { body: cardBody('3DS') })
      expect(response.status).toBe(200)
      const result = response.body as { paymentStatus: string; challenge: { url: string } }
      expect(result.paymentStatus).toBe('action_required')
      expect(result.challenge.url).toMatch(
        /\/api\/v1\/__simulated\/mercadopago\/challenge\?payment=\d{10}$/,
      )
      expect(result.challenge.url.startsWith(simulatorOrigin())).toBe(true)
      const pending = await readOrder(order)
      expect(pending.paymentStatus).toBe('action_required')
      expect(pending.payment.challenge).toEqual({ url: result.challenge.url })

      const page = await send('get', simulatorPath(result.challenge.url))
      expect(page.status).toBe(200)
      expect(page.text).toContain('Verificación de tu banco (simulada)')
      const payment = new URL(result.challenge.url).searchParams.get('payment') ?? ''
      const done = await request(server())
        .post('/api/v1/__simulated/mercadopago/resolve')
        .type('form')
        .send({ payment, result: 'challenge_ok' })

      expect(done.status).toBe(200)
      expect(done.text).toContain('Listo. Ya podés cerrar esta ventana.')
      const paid = await readOrder(order)
      expect(paid.status).toBe('paid')
      expect(paid.payment.challenge).toBeNull()
    })

    it('OTHE → rejected con statusDetail; el pedido queda vencible y el barrido lo vence', async () => {
      const order = await placeOrder()

      const response = await pay('card', order.number, order.token, { body: cardBody('OTHE') })
      const rejected = await readOrder(order)
      await reservationEndedAgo(order, 1)
      await app?.get(PaymentsSweep).runOnce()
      const expired = await readOrder(order)

      expect(response.status).toBe(200)
      expect(response.body).toEqual({
        paymentStatus: 'rejected',
        statusDetail: 'cc_rejected_other_reason',
        challenge: null,
      })
      expect(rejected.paymentStatus).toBe('rejected')
      expect(rejected.payment.statusDetail).toBe('cc_rejected_other_reason')
      expect(expired.status).toBe('expired')
    })

    it('cuotas: crédito → 5 opciones sobre el total; débito → solo 1 pago', async () => {
      const order = await placeOrder()

      const credit = await pay('installments', order.number, order.token)
      const debit = await pay('installments', order.number, order.token, {
        body: { bin: '450312', paymentTypeId: 'debit_card' },
      })

      expect(credit.status).toBe(200)
      const options = credit.body as {
        installments: number
        totalArs: number
        cftPercent: number
      }[]
      expect(options.map((option) => option.installments)).toEqual([1, 2, 3, 6, 12])
      expect(options.slice(0, 3).every((option) => option.totalArs === ORDER_TOTAL)).toBe(true)
      expect(options.slice(3).every((option) => option.cftPercent === 45.9)).toBe(true)
      expect(debit.status).toBe(200)
      expect(debit.body).toEqual([
        {
          installments: 1,
          installmentAmountArs: ORDER_TOTAL,
          totalArs: ORDER_TOTAL,
          cftPercent: 0,
          teaPercent: 0,
          label: '1 pago de $16.499',
        },
      ])
    })
  })

  describe('Review Focus 4: token y estado en las cuatro rutas', () => {
    const ROUTES: readonly PaymentRoute[] = ['preference', 'card', 'installments', 'cancel']

    it('sin token o con un token ajeno → el mismo 404 en las cuatro rutas, nunca 401', async () => {
      const order = await placeOrder()
      const other = await placeOrder()

      for (const route of ROUTES) {
        const body = route === 'card' ? cardBody('APRO') : undefined
        const options = body === undefined ? {} : { body }
        const missing = await pay(route, order.number, null, options)
        const foreign = await pay(route, order.number, other.token, options)
        for (const response of [missing, foreign]) {
          expect(response.status, route).toBe(404)
          expect(response.body).toMatchObject({
            type: 'not_found',
            title: 'No encontrado',
            detail: 'No encontramos ese pedido.',
          })
        }
      }
      expect((await readOrder(order)).paymentStatus).toBe('none')
    })

    it('pedido vencido → 409 "El pedido venció." en las cuatro rutas', async () => {
      const order = await placeOrder()
      await reservationEndedAgo(order, 1)

      for (const route of ROUTES) {
        const response = await pay(route, order.number, order.token, {
          ...(route === 'card' ? { body: cardBody('APRO') } : {}),
        })
        expect(response.status, route).toBe(409)
        expect(response.body).toMatchObject({
          type: 'order_not_payable',
          title: 'El pedido no admite un pago nuevo',
          detail: 'El pedido venció.',
        })
      }
    })

    it('pedido pagado → 409 "El pedido ya está pagado." en las cuatro rutas', async () => {
      const order = await placeOrder()
      expect(
        (await pay('card', order.number, order.token, { body: cardBody('APRO') })).status,
      ).toBe(200)

      for (const route of ROUTES) {
        const response = await pay(route, order.number, order.token, {
          ...(route === 'card' ? { body: cardBody('APRO') } : {}),
        })
        expect(response.status, route).toBe(409)
        expect(response.body).toMatchObject({
          type: 'order_not_payable',
          detail: 'El pedido ya está pagado.',
        })
      }
    })
  })

  describe('Review Focus 1: nunca dos cobros válidos', () => {
    it('otro APRO → 409; un segundo aprobado por webhook se devuelve una sola vez y el stock se confirma una vez', async () => {
      const before = await stockOf(yerba)
      const order = await placeOrder()

      const first = await pay('card', order.number, order.token, { body: cardBody('APRO') })
      const second = await pay('card', order.number, order.token, { body: cardBody('APRO') })
      expect(first.status).toBe(200)
      expect(second.status).toBe(409)
      expect(second.body).toMatchObject({ detail: 'El pedido ya está pagado.' })

      // Un segundo pago aprobado del mismo pedido que llega igual (otra pestaña, Checkout Pro).
      const duplicate = providerPayment(order)
      gateway().remember(duplicate)
      const eventId = randomUUID()
      expect((await notify(duplicate.providerPaymentId, eventId)).status).toBe(200)
      await processedEvent(eventId)
      expect((await notify(duplicate.providerPaymentId, eventId)).status).toBe(200)

      const refunds = await prisma().refund.findMany({
        where: { payment: { orderId: order.id } },
      })
      expect(refunds).toEqual([
        expect.objectContaining({ reason: 'duplicate_payment', amountArs: ORDER_TOTAL }),
      ])
      expect(
        gateway()
          .callsTo('refundPayment')
          .filter(([id]) => id === duplicate.providerPaymentId),
      ).toHaveLength(1)
      const view = await readOrder(order)
      expect(view.status).toBe('paid')
      expect(view.history.filter((entry) => entry.status === 'paid')).toHaveLength(1)
      expect(await stockOf(yerba)).toEqual({
        onHand: before.onHand - 1,
        reserved: before.reserved,
      })
    })
  })

  describe('Review Focus 2: notificaciones repetidas y desordenadas', () => {
    it('un pending viejo después del approved no cambia nada', async () => {
      const order = await placeOrder()
      await pay('card', order.number, order.token, { body: cardBody('APRO') })
      const paid = await readOrder(order)
      const providerPaymentId = paid.payment.mpPaymentId ?? ''

      gateway().remember(
        providerPayment(order, {
          providerPaymentId,
          status: 'pending',
          statusDetail: 'pending_contingency',
          approvedAt: null,
        }),
      )
      const eventId = randomUUID()
      expect((await notify(providerPaymentId, eventId)).status).toBe(200)
      await processedEvent(eventId)

      const view = await readOrder(order)
      expect(view.status).toBe('paid')
      expect(view.paymentStatus).toBe('approved')
      expect(view.payment.statusDetail).toBe('accredited')
    })

    it('approved después de expired → devolución late_approval y el pedido sigue vencido', async () => {
      const order = await placeOrder()
      expect((await pay('preference', order.number, order.token)).status).toBe(200)
      await reservationEndedAgo(order, 1)
      await app?.get(PaymentsSweep).runOnce()
      expect((await readOrder(order)).status).toBe('expired')

      const late = providerPayment(order)
      gateway().remember(late)
      const eventId = randomUUID()
      expect((await notify(late.providerPaymentId, eventId)).status).toBe(200)
      await processedEvent(eventId)

      expect(
        await prisma().refund.findMany({
          where: { payment: { orderId: order.id } },
          select: { reason: true, status: true, amountArs: true },
        }),
      ).toEqual([{ reason: 'late_approval', status: 'approved', amountArs: ORDER_TOTAL }])
      expect((await readOrder(order)).status).toBe('expired')
    })
  })

  describe('Review Focus 5: webhook firmado con MP_WEBHOOK_SECRET', () => {
    it('firma válida con el pago de una tarjeta pendiente → 200, evento registrado y procesado; duplicado sin reprocesar', async () => {
      const order = await placeOrder()
      await pay('card', order.number, order.token, { body: cardBody('CONT') })
      const providerPaymentId = (await readOrder(order)).payment.mpPaymentId ?? ''
      gateway().remember(providerPayment(order, { providerPaymentId }))
      const eventId = randomUUID()

      const response = await notify(providerPaymentId, eventId)
      const row = await processedEvent(eventId)
      const duplicate = await notify(providerPaymentId, eventId)

      expect(response.status).toBe(200)
      expect(response.text).toBe('')
      expect(row).toMatchObject({
        provider: 'mercadopago',
        type: 'payment',
        resourceId: providerPaymentId,
        signatureValid: true,
        lastError: null,
      })
      expect(duplicate.status).toBe(200)
      const rows = await prisma().webhookEvent.findMany({ where: { eventId } })
      expect(rows).toHaveLength(1)
      expect(rows[0]?.processedAt).toEqual(row.processedAt)
      expect(rows[0]?.attempts).toBe(row.attempts)
      const view = await readOrder(order)
      expect(view.status).toBe('paid')
      expect(view.paymentStatus).toBe('approved')
    })

    it('data.id con mayúsculas se firma en minúsculas y x-signature con espacios se parsea igual', async () => {
      const upper = randomUUID()
      const spaced = randomUUID()
      const [ts = '', v1 = ''] = signWebhook({ dataId: '424242', requestId: REQUEST_ID })
        .split(',')
        .map((part) => part.split('=')[1] ?? '')

      const upperResponse = await notify('ABC123', upper)
      const spacedResponse = await notify('424242', spaced, ` ts = ${ts} , v1 = ${v1} `)

      expect(upperResponse.status).toBe(200)
      expect(spacedResponse.status).toBe(200)
      // Ninguno de los dos pagos existe en la pasarela: se procesan con el error anotado.
      expect((await processedEvent(upper)).lastError).not.toBeNull()
      expect((await processedEvent(spaced)).lastError).not.toBeNull()
    })

    it.each([
      [
        'v1 cambiado',
        (signature: string) =>
          signature.replace(/v1=./, (match) => (match.endsWith('0') ? 'v1=1' : 'v1=0')),
      ],
      ['sin ts', (signature: string) => signature.replace(/^ts=\d+,/, '')],
      ['sin x-signature', () => null],
    ])(
      '%s → 401 con el cuerpo del contrato, sin registrar (ni encolar) nada',
      async (_name, tamper) => {
        const eventId = randomUUID()
        const signature = tamper(signWebhook({ dataId: '777', requestId: REQUEST_ID }))
        const before = await prisma().webhookEvent.count()

        const response = await send('post', '/webhooks/mercadopago?data.id=777&type=payment', {
          headers: {
            'x-request-id': REQUEST_ID,
            ...(signature === null ? {} : { 'x-signature': signature }),
          },
          body: { id: eventId, type: 'payment', data: { id: '777' } },
        })

        expect(response.status).toBe(401)
        expect(response.body).toEqual({
          type: 'invalid_signature',
          title: 'Firma inválida',
          status: 401,
          detail: 'La firma de la notificación no coincide.',
          instance: '/api/v1/webhooks/mercadopago',
        })
        expect(await prisma().webhookEvent.count()).toBe(before)
      },
    )

    it('formato IPN (?topic=&id=, sin firma) → 200 sin registrar nada', async () => {
      const before = await prisma().webhookEvent.count()

      const response = await send('post', '/webhooks/mercadopago?topic=payment&id=1234567890', {
        body: { resource: '1234567890', topic: 'payment' },
      })

      expect(response.status).toBe(200)
      expect(await prisma().webhookEvent.count()).toBe(before)
    })
  })
})
