import type { INestApplication } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import type { Server } from 'node:http'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createControllerApp } from '../../../../test/support/controller-app'
import {
  createPaymentsHarness,
  ORDER_TOKEN,
  type PaymentsHarness,
  simToken,
  STORE_ORIGIN,
} from '../../../../test/support/payments'
import { ENV, type Env } from '../../../config/env'
import { ORDER_PAYMENTS_PORT } from '../../orders/application/ports/order-payments.port'
import { SimulateProviderResultCommand } from '../application/commands/simulate-provider-result.command'
import { PAYMENT_REPOSITORY } from '../application/ports/payment.repository.port'
import { PAYMENTS_SETTINGS } from '../application/ports/payments-settings.port'
import { SimulatedMercadoPagoController } from './simulated-mercadopago.controller'
import { escapeHtml } from './simulated-pages'

type SimulatorEnv = Pick<Env, 'MP_MODE' | 'NODE_ENV'>

/** Arma la app del simulador con los casos de uso del arnés y el entorno dado. */
function simulatorApp(
  harness: PaymentsHarness,
  env: SimulatorEnv,
): Promise<INestApplication<Server>> {
  return createControllerApp({
    controllers: [SimulatedMercadoPagoController],
    providers: [
      { provide: ENV, useValue: env },
      { provide: SimulateProviderResultCommand, useValue: harness.simulate },
      { provide: PAYMENT_REPOSITORY, useValue: harness.payments },
      { provide: ORDER_PAYMENTS_PORT, useValue: harness.orders },
      { provide: PAYMENTS_SETTINGS, useValue: harness.settings },
    ],
  })
}

describe('escapeHtml', () => {
  it('escapa los cinco caracteres especiales de HTML', () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe(
      '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;',
    )
  })
})

describe('SimulatedMercadoPagoController en modo simulado', () => {
  let harness: PaymentsHarness
  let app: INestApplication<Server> | undefined

  beforeAll(async () => {
    harness = createPaymentsHarness()
    app = await simulatorApp(harness, { MP_MODE: 'simulated', NODE_ENV: 'test' })
  })

  afterAll(async () => {
    await app?.close()
  })

  function server(): Server {
    if (app === undefined) throw new Error('La app no arrancó')
    return app.getHttpServer()
  }

  /** Pedido con una preferencia creada: devuelve el pedido y el id de la preferencia. */
  async function withPreference() {
    const order = harness.orders.add()
    const { initPoint } = await harness.preference.execute(
      { number: order.number, token: ORDER_TOKEN },
      randomUUID(),
    )
    const preference = new URL(initPoint).searchParams.get('preference')
    if (preference === null) throw new Error('La preferencia no trae su id')
    return { order, preference }
  }

  /** Pedido con un pago 3DS pendiente: devuelve el pedido y el id del pago. */
  async function withChallenge() {
    const order = harness.orders.add()
    const result = await harness.card.execute(
      { number: order.number, token: ORDER_TOKEN },
      {
        token: simToken('3DS'),
        paymentMethodId: 'visa',
        issuerId: null,
        installments: 1,
        payer: { email: 'ana@example.com', identification: { type: 'DNI', number: '12345678' } },
      },
      randomUUID(),
    )
    const payment =
      result.challenge === null ? null : new URL(result.challenge.url).searchParams.get('payment')
    if (payment === null) throw new Error('El pago 3DS no trae su desafío')
    return { order, payment }
  }

  it('GET checkout: página HTML con el pedido, el total y los tres botones', async () => {
    const { order, preference } = await withPreference()

    const response = await request(server()).get(
      `/__simulated/mercadopago/checkout?preference=${preference}`,
    )

    expect(response.status).toBe(200)
    expect(response.headers['content-type']).toContain('text/html')
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.headers['content-security-policy']).toContain(
      `form-action 'self' ${STORE_ORIGIN}`,
    )
    expect(response.headers['content-security-policy']).toContain(
      `frame-ancestors 'self' ${STORE_ORIGIN}`,
    )
    expect(response.text).toContain('Mercado Pago')
    expect(response.text).toContain('Simulador · modo de prueba')
    expect(response.text).toContain('Elegí cómo termina el pago')
    expect(response.text).toContain(order.number)
    expect(response.text).toContain('$68.397')
    expect(response.text).toContain(`name="preference" value="${preference}"`)
    for (const [value, label] of [
      ['approved', 'Aprobar'],
      ['pending', 'Dejar pendiente'],
      ['rejected', 'Rechazar'],
    ] as const) {
      expect(response.text).toContain(`name="result" value="${value}"`)
      expect(response.text).toContain(`>${label}</button>`)
    }
  })

  it('GET checkout de una preferencia que no existe (o sin preferencia) → 404 con el aviso', async () => {
    const unknown = await request(server()).get(
      '/__simulated/mercadopago/checkout?preference=%3Cscript%3E',
    )
    const missing = await request(server()).get('/__simulated/mercadopago/checkout')

    for (const response of [unknown, missing]) {
      expect(response.status).toBe(404)
      expect(response.headers['content-type']).toContain('text/html')
      expect(response.text).toContain(
        'Este link de pago no sirve: le falta el pedido o el intento de pago.',
      )
      expect(response.text).not.toContain('<script>')
    }
  })

  it('POST resolve approved (formulario) → 302 a la tienda y el pedido pagado; otra vez → 409', async () => {
    const { order, preference } = await withPreference()

    const response = await request(server())
      .post('/__simulated/mercadopago/resolve')
      .type('form')
      .send({ preference, result: 'approved' })
    const again = await request(server())
      .post('/__simulated/mercadopago/resolve')
      .send({ preference, result: 'approved' })

    expect(response.status).toBe(302)
    expect(response.headers.location).toBe(
      `${STORE_ORIGIN}/checkout/resultado?pedido=${order.number}`,
    )
    expect(harness.orders.get(order.id).status).toBe('paid')
    expect(again.status).toBe(409)
    expect(again.body).toEqual({
      type: 'intent_not_active',
      title: 'El intento ya no está activo',
      status: 409,
      detail: 'El pago se canceló, venció o ya se resolvió.',
      instance: '/__simulated/mercadopago/resolve',
    })
  })

  it('GET challenge y POST resolve challenge_ok → "Listo" con el postMessage, pedido pagado', async () => {
    const { order, payment } = await withChallenge()

    const page = await request(server()).get(
      `/__simulated/mercadopago/challenge?payment=${payment}`,
    )
    const done = await request(server())
      .post('/__simulated/mercadopago/resolve')
      .send({ payment, result: 'challenge_ok' })

    expect(page.status).toBe(200)
    expect(page.text).toContain('Verificación de tu banco (simulada)')
    expect(page.text).toContain(`name="payment" value="${payment}"`)
    expect(page.text).toContain('>Confirmar</button>')
    expect(page.text).toContain('>Cancelar</button>')
    expect(done.status).toBe(200)
    expect(done.headers['content-type']).toContain('text/html')
    expect(done.text).toContain('Listo. Ya podés cerrar esta ventana.')
    expect(done.text).toContain("parent.postMessage({ type: 'galpon:challenge-done' }, '*')")
    expect(done.headers['content-security-policy']).toMatch(/script-src 'sha256-[A-Za-z0-9+/=]+'/)
    expect(harness.orders.get(order.id).status).toBe('paid')
  })

  it('POST resolve challenge_failed → rechazado con cc_rejected_3ds_challenge', async () => {
    const { order, payment } = await withChallenge()

    const done = await request(server())
      .post('/__simulated/mercadopago/resolve')
      .type('form')
      .send({ payment, result: 'challenge_failed' })

    expect(done.status).toBe(200)
    expect(done.text).toContain('Listo. Ya podés cerrar esta ventana.')
    expect(harness.payments.of(order.id).at(-1)).toMatchObject({
      status: 'rejected',
      statusDetail: 'cc_rejected_3ds_challenge',
    })
  })

  it('POST resolve sin preferencia ni pago, o con otro resultado → 422; pago que no existe → 404', async () => {
    const neither = await request(server())
      .post('/__simulated/mercadopago/resolve')
      .send({ result: 'approved' })
    const badResult = await request(server())
      .post('/__simulated/mercadopago/resolve')
      .send({ preference: 'sim-pref-x', result: 'paid' })
    const unknown = await request(server())
      .post('/__simulated/mercadopago/resolve')
      .send({ payment: '0000000000', result: 'challenge_ok' })

    expect(neither.status).toBe(422)
    expect(neither.body).toMatchObject({
      errors: [
        { field: 'preference', code: 'required', message: 'Falta la preferencia o el pago.' },
      ],
    })
    expect(badResult.status).toBe(422)
    expect(badResult.body).toMatchObject({ errors: [{ field: 'result', code: 'invalid_value' }] })
    expect(unknown.status).toBe(404)
    expect(unknown.body).toMatchObject({
      type: 'not_found',
      detail: 'No existe ese intento de pago.',
    })
  })
})

describe('SimulatedMercadoPagoController fuera del modo simulado', () => {
  it.each([
    [{ MP_MODE: 'live', NODE_ENV: 'development' }],
    [{ MP_MODE: 'simulated', NODE_ENV: 'production' }],
  ] as [SimulatorEnv][])('%o → 404 como una ruta que no existe', async (env) => {
    const harness = createPaymentsHarness()
    const app = await simulatorApp(harness, env)
    try {
      const page = await request(app.getHttpServer()).get(
        '/__simulated/mercadopago/checkout?preference=sim-pref-1',
      )
      const resolve = await request(app.getHttpServer())
        .post('/__simulated/mercadopago/resolve')
        .send({ preference: 'sim-pref-1', result: 'approved' })

      expect(page.status).toBe(404)
      expect(page.body).toEqual({
        type: 'not_found',
        title: 'No encontrado',
        status: 404,
        detail: 'No existe la ruta GET /__simulated/mercadopago/checkout.',
        instance: '/__simulated/mercadopago/checkout',
      })
      expect(resolve.status).toBe(404)
      expect(resolve.body).toMatchObject({
        detail: 'No existe la ruta POST /__simulated/mercadopago/resolve.',
      })
    } finally {
      await app.close()
    }
  })
})
