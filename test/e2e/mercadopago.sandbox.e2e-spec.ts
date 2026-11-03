import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'

import type { OrderForPayment } from '../../src/modules/orders/application/ports/order-payments.port'
import { MercadoPagoGateway } from '../../src/modules/payments/infrastructure/mercadopago.gateway'
import { SystemClock } from '../../src/shared/domain/clock'

/**
 * Prueba contra el sandbox real de Mercado Pago (Ruling B-57). Se omite sin `MP_ACCESS_TOKEN`:
 * nunca corre en CI ni en `npm run test:e2e` sin credenciales. Para correrla, con las credenciales
 * de prueba que pasa Lucas (ver la guía del README):
 *
 * ```sh
 * MP_ACCESS_TOKEN=APP_USR-… MP_PUBLIC_KEY=APP_USR-… MP_TEST_PAYER_EMAIL=test_user_…@testuser.com \
 *   npx vitest run -c vitest.e2e.config.mts test/e2e/mercadopago.sandbox.e2e-spec.ts
 * ```
 *
 * `MP_PUBLIC_KEY` es la del front (`NEXT_PUBLIC_MP_PUBLIC_KEY`) y solo se usa acá para tokenizar
 * la Visa de prueba; sin ella el token se pide con el access token. No necesita Docker: llama a
 * la pasarela con un pedido armado a mano.
 */
const ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN

/** Visa de prueba de Argentina; el titular `APRO` aprueba el pago. */
const TEST_CARD = {
  card_number: '4509953566233704',
  expiration_month: 11,
  expiration_year: 2030,
  security_code: '123',
  cardholder: { name: 'APRO', identification: { type: 'DNI', number: '12345678' } },
}

/** Pedido de prueba (no existe en la base: la pasarela solo usa estos datos). */
function sandboxOrder(): OrderForPayment {
  const now = new Date()
  return {
    id: randomUUID(),
    number: `GLP-SBX-${String(now.getTime())}`,
    status: 'pending_payment',
    paymentStatus: 'none',
    paymentMethod: 'card',
    totalArs: 15000,
    shippingCostArs: 0,
    accessTokenHash: 'sandbox',
    reservedUntil: new Date(now.getTime() + 30 * 60_000),
    createdAt: now,
    customerId: null,
    contact: {
      email: process.env.MP_TEST_PAYER_EMAIL ?? 'comprador@example.com',
      firstName: 'APRO',
      lastName: 'Prueba',
      phone: null,
    },
    lines: [{ id: randomUUID(), name: 'Mate de prueba', quantity: 1, totalArs: 15000 }],
  }
}

/** Token de un solo uso de la Visa de prueba (`POST /v1/card_tokens`). */
async function cardToken(accessToken: string): Promise<string> {
  const publicKey = process.env.MP_PUBLIC_KEY
  const url = new URL('https://api.mercadopago.com/v1/card_tokens')
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (publicKey === undefined) headers.Authorization = `Bearer ${accessToken}`
  else url.searchParams.set('public_key', publicKey)
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(TEST_CARD),
  })
  const body = (await response.json()) as { id?: unknown }
  if (!response.ok || typeof body.id !== 'string') {
    throw new Error(
      `Mercado Pago no tokenizó la tarjeta de prueba (HTTP ${String(response.status)})`,
    )
  }
  return body.id
}

describe.skipIf(ACCESS_TOKEN === undefined)(
  'sandbox de Mercado Pago (credenciales de prueba)',
  () => {
    // Una sola pasarela (y un solo `MercadoPagoConfig`) para todas las llamadas, como en la
    // aplicación: el SDK guarda en el config las opciones de la última llamada, y con una pasarela
    // nueva por llamada ese arrastre nunca se vería.
    let instance: MercadoPagoGateway | undefined
    function gateway(): MercadoPagoGateway {
      if (ACCESS_TOKEN === undefined) throw new Error('Falta MP_ACCESS_TOKEN')
      instance ??= new MercadoPagoGateway({ accessToken: ACCESS_TOKEN, clock: new SystemClock() })
      return instance
    }

    it('crea una preferencia real con el initPoint de Mercado Pago', async () => {
      const order = sandboxOrder()

      const preference = await gateway().createPreference({
        order,
        idempotencyKey: randomUUID(),
        notificationUrl: null,
        backUrl: `https://galpon.example/checkout/resultado?pedido=${order.number}`,
        expiresAt: order.reservedUntil,
        statementDescriptor: 'GALPON MATES',
      })

      expect(preference.preferenceId).not.toBe('')
      expect(preference.initPoint).toMatch(/^https:\/\/www\.mercadopago\.com(\.ar)?\//)
      await expect(gateway().expirePreference(preference.preferenceId)).resolves.toBeUndefined()
    })

    it('cobra con la Visa de prueba (APRO) y lee el mismo pago', async () => {
      if (ACCESS_TOKEN === undefined) throw new Error('Falta MP_ACCESS_TOKEN')
      const order = sandboxOrder()

      const payment = await gateway().createCardPayment({
        order,
        idempotencyKey: randomUUID(),
        token: await cardToken(ACCESS_TOKEN),
        paymentMethodId: 'visa',
        issuerId: null,
        installments: 1,
        payer: {
          email: order.contact.email,
          identification: { type: 'DNI', number: '12345678' },
        },
        notificationUrl: null,
        statementDescriptor: 'GALPON MATES',
      })

      expect(payment).toMatchObject({
        status: 'approved',
        amountArs: 15000,
        externalReference: order.number,
        cardLastFour: '3704',
      })
      expect(await gateway().getPayment(payment.providerPaymentId)).toMatchObject({
        providerPaymentId: payment.providerPaymentId,
        status: 'approved',
      })
    })

    it('consulta las cuotas de una Visa de crédito', async () => {
      const options = await gateway().getInstallments({
        bin: '450995',
        paymentTypeId: 'credit_card',
        amountArs: 15000,
        maxWithoutInterest: 3,
      })

      expect(options[0]).toMatchObject({ installments: 1 })
    })
  },
)
