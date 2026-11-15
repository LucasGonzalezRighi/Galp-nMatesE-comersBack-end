import { APP_GUARD } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { Test } from '@nestjs/testing'
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler'
import { randomUUID } from 'node:crypto'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { applyTrustProxy } from '../../../shared/infrastructure/http/client-ip'
import { ProblemFilter } from '../../../shared/infrastructure/http/problem.filter'
import { createValidationPipe } from '../../../shared/infrastructure/http/validation.pipe'
import { skipWithoutKnownClientIp } from '../../../shared/infrastructure/throttler/client-rate-limit'
import { CancelPaymentCommand } from '../application/commands/cancel-payment.command'
import { CreatePreferenceCommand } from '../application/commands/create-preference.command'
import { PayWithCardCommand } from '../application/commands/pay-with-card.command'
import { ReceiveWebhookCommand } from '../application/commands/receive-webhook.command'
import { GetInstallmentsQuery } from '../application/queries/get-installments.query'
import { PaymentsController } from './payments.controller'
import { WebhooksController } from './webhooks.controller'

/** Límite global de la app de prueba: chico (en producción son 120), así uno activo se nota. */
const TEST_LIMIT = 2

/** Cuotas por minuto por cliente (NV-16). */
const INSTALLMENTS_PER_MINUTE = 60

/** Las demás rutas de pago, por minuto por cliente y por ruta (NV-16). */
const PAYMENTS_PER_MINUTE = 30

const NUMBER = 'GLP-12345'

/** Las rutas de pago con un cuerpo válido (los casos de uso son dobles: el límite va antes). */
const ROUTES = {
  installments: {
    path: `/orders/${NUMBER}/payments/mercadopago/installments`,
    body: { bin: '450995', paymentTypeId: 'credit_card' },
  },
  preference: { path: `/orders/${NUMBER}/payments/mercadopago/preference`, body: undefined },
  card: {
    path: `/orders/${NUMBER}/payments/mercadopago/card`,
    body: {
      token: 'sim_APRO_3704_0123456789abcdef0123456789abcdef',
      paymentMethodId: 'visa',
      issuerId: null,
      installments: 1,
      payer: { email: 'ana@example.com', identification: { type: 'DNI', number: '12345678' } },
    },
  },
  cancel: { path: `/orders/${NUMBER}/cancel-payment`, body: undefined },
  webhook: { path: '/webhooks/mercadopago?data.id=123', body: { data: { id: '123' } } },
} as const

type Route = keyof typeof ROUTES

/** Caso de uso en memoria: responde enseguida, así ninguna ruta llega a Mercado Pago. */
const instant = (result: unknown) => ({ execute: () => Promise.resolve(result) })

/** App de prueba con el guard global, el `skipIf` de producción y `trust proxy`. */
async function paymentsApp(trustProxy: readonly string[]): Promise<NestExpressApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [
      ThrottlerModule.forRoot({
        throttlers: [{ ttl: 60_000, limit: TEST_LIMIT }],
        skipIf: skipWithoutKnownClientIp,
      }),
    ],
    controllers: [PaymentsController, WebhooksController],
    providers: [
      { provide: APP_GUARD, useClass: ThrottlerGuard },
      { provide: CreatePreferenceCommand, useValue: instant({ initPoint: 'https://mp.test/1' }) },
      { provide: PayWithCardCommand, useValue: instant({ status: 'approved' }) },
      { provide: GetInstallmentsQuery, useValue: instant([]) },
      { provide: CancelPaymentCommand, useValue: instant(undefined) },
      { provide: ReceiveWebhookCommand, useValue: instant(undefined) },
    ],
  }).compile()
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false })
  applyTrustProxy(app, trustProxy)
  app.useGlobalFilters(new ProblemFilter())
  app.useGlobalPipes(createValidationPipe())
  await app.init()
  return app
}

describe('rutas de pago con límite por IP real del cliente (NV-16)', () => {
  let withoutTrust: NestExpressApplication | undefined
  let withTrust: NestExpressApplication | undefined

  beforeAll(async () => {
    withoutTrust = await paymentsApp([])
    withTrust = await paymentsApp(['loopback'])
  })

  afterAll(async () => {
    await withoutTrust?.close()
    await withTrust?.close()
  })

  /** Repite `POST` a la ruta y devuelve los códigos (con `X-Forwarded-For` si viene). */
  async function statusesOf(
    app: NestExpressApplication | undefined,
    route: Route,
    times: number,
    forwardedFor?: string,
  ): Promise<number[]> {
    if (app === undefined) throw new Error('La app no arrancó')
    const { path, body } = ROUTES[route]
    const statuses: number[] = []
    for (let i = 0; i < times; i += 1) {
      let pending = request(app.getHttpServer())
        .post(path)
        .set('X-Order-Token', 'token-del-pedido')
        .set('Idempotency-Key', randomUUID())
      if (forwardedFor !== undefined) pending = pending.set('X-Forwarded-For', forwardedFor)
      const response = body === undefined ? await pending : await pending.send(body)
      statuses.push(response.status)
    }
    return statuses
  }

  it(`con TRUST_PROXY, las cuotas dejan ${String(INSTALLMENTS_PER_MINUTE)} por minuto al cliente y la siguiente → 429 problem+json`, async () => {
    const statuses = await statusesOf(
      withTrust,
      'installments',
      INSTALLMENTS_PER_MINUTE + 1,
      '203.0.113.40',
    )

    expect(statuses.slice(0, INSTALLMENTS_PER_MINUTE)).not.toContain(429)
    expect(statuses.at(-1)).toBe(429)
  })

  it.each(['preference', 'card', 'cancel'] as const)(
    `con TRUST_PROXY, %s deja ${String(PAYMENTS_PER_MINUTE)} por minuto al cliente y la siguiente → 429`,
    async (route) => {
      const client = { preference: '203.0.113.41', card: '203.0.113.42', cancel: '203.0.113.43' }

      const statuses = await statusesOf(withTrust, route, PAYMENTS_PER_MINUTE + 1, client[route])

      expect(statuses.slice(0, PAYMENTS_PER_MINUTE)).not.toContain(429)
      expect(statuses.at(-1)).toBe(429)
    },
  )

  it('el 429 sale como problem+json rate_limited con Retry-After', async () => {
    if (withTrust === undefined) throw new Error('La app no arrancó')
    await statusesOf(withTrust, 'cancel', PAYMENTS_PER_MINUTE, '203.0.113.44')

    const response = await request(withTrust.getHttpServer())
      .post(ROUTES.cancel.path)
      .set('X-Order-Token', 'token-del-pedido')
      .set('X-Forwarded-For', '203.0.113.44')

    expect(response.status).toBe(429)
    expect(response.headers['content-type']).toMatch(/^application\/problem\+json/)
    expect(response.body).toMatchObject({ type: 'rate_limited', status: 429 })
    expect(Number(response.headers['retry-after'])).toBeGreaterThanOrEqual(1)
  })

  it('el servidor de la tienda (sin X-Forwarded-For) y cualquiera sin TRUST_PROXY no se cuentan', async () => {
    const store = await statusesOf(withTrust, 'installments', INSTALLMENTS_PER_MINUTE + 1)
    const storeCancel = await statusesOf(withTrust, 'cancel', PAYMENTS_PER_MINUTE + 1)
    const untrusted = await statusesOf(
      withoutTrust,
      'installments',
      INSTALLMENTS_PER_MINUTE + 1,
      '203.0.113.45',
    )

    expect(store).not.toContain(429)
    expect(storeCancel).not.toContain(429)
    expect(untrusted).not.toContain(429)
  })

  it('el webhook de Mercado Pago sigue sin límite, también con un cliente conocido', async () => {
    const statuses = await statusesOf(withTrust, 'webhook', TEST_LIMIT + 8, '203.0.113.46')

    expect(statuses).not.toContain(429)
  })
})
